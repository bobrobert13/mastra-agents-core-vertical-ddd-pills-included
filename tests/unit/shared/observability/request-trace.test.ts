/**
 * Chat request trace — unit tier. Deterministic and offline: no model calls.
 * The middleware is exercised on a real (in-process) Hono app so `c.res`
 * replacement and the SSE passthrough are covered, not just the helpers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { TripWire } from '@mastra/core/agent';

import {
  chatTraceEnabled,
  currentChatTrace,
  formatMs,
  openChatTrace,
  runWithChatTrace,
  shortTraceId,
  stageSummary,
  tracedProcessor,
} from '../../../../src/mastra/shared/observability/request-trace';
import { requestTrace } from '../../../../src/mastra/routes/middleware/request-trace';

type HonoMiddleware = Parameters<Hono['use']>[1];

let infoSpy: ReturnType<typeof vi.spyOn>;
let lines: string[];

beforeEach(() => {
  lines = [];
  infoSpy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  infoSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe('chatTraceEnabled', () => {
  it('defaults to ON outside production and OFF in production', () => {
    expect(chatTraceEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(chatTraceEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(chatTraceEnabled({})).toBe(true);
  });

  it('CHAT_TRACE=on|off overrides the environment default', () => {
    expect(chatTraceEnabled({ NODE_ENV: 'production', CHAT_TRACE: 'on' })).toBe(true);
    expect(chatTraceEnabled({ NODE_ENV: 'development', CHAT_TRACE: 'off' })).toBe(false);
    expect(chatTraceEnabled({ NODE_ENV: 'development', CHAT_TRACE: 'OFF' })).toBe(false);
  });
});

describe('id / formatting helpers', () => {
  it('shortTraceId is 8 hex, stable from the x-request-id seed', () => {
    expect(shortTraceId('b15c2146-d6d6-46f1-a55c-fea9cbc8701e')).toBe('b15c2146');
    expect(shortTraceId()).toMatch(/^[0-9a-f]{8}$/);
    expect(shortTraceId('nope')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('formatMs and stageSummary render one compact form', () => {
    expect(formatMs(1250)).toBe('1.25s');
    const trace = openChatTrace('comms');
    trace.stages.set('scope-guard', 1250);
    trace.stages.set('cache', 3);
    expect(stageSummary(trace)).toBe('scope-guard 1.25s, cache 0.00s');
    expect(stageSummary(openChatTrace('comms'))).toBe('');
  });
});

describe('tracedProcessor', () => {
  class Probe {
    id = 'probe-processor';
    calls = 0;
    #secret = 'kept';
    async processInput(args: unknown): Promise<unknown> {
      this.calls += 1;
      return args;
    }
    readSecret(): string {
      return this.#secret;
    }
  }

  it('is a no-op passthrough with CHAT_TRACE=off (identity preserved)', async () => {
    vi.stubEnv('CHAT_TRACE', 'off');
    const probe = new Probe();
    expect(tracedProcessor(probe)).toBe(probe);
    await expect(probe.processInput('x')).resolves.toBe('x');
    expect(lines).toHaveLength(0);
  });

  it('outside an active trace it delegates without logging', async () => {
    vi.stubEnv('CHAT_TRACE', 'on');
    const probe = new Probe();
    const traced = tracedProcessor(probe);
    await expect(traced.processInput('x')).resolves.toBe('x');
    expect(lines).toHaveLength(0);
  });

  it('inside a trace it logs one line per stage and preserves this/prototype', async () => {
    vi.stubEnv('CHAT_TRACE', 'on');
    const probe = new Probe();
    const traced = tracedProcessor(probe);
    const trace = openChatTrace('probe');

    expect(traced instanceof Probe).toBe(true);
    expect(traced.readSecret()).toBe('kept'); // private field via `this` = original
    expect(traced.id).toBe('probe-processor');

    const result = await runWithChatTrace(trace, () => traced.processInput('payload'));
    expect(result).toBe('payload');
    expect(probe.calls).toBe(1);
    expect(trace.stages.get('probe-processor')).toBeGreaterThanOrEqual(0);
    expect(lines.some(line => line.includes('· probe-processor ok'))).toBe(true);
  });

  it('a TripWire records the stage as blocked and is re-thrown untouched', async () => {
    vi.stubEnv('CHAT_TRACE', 'on');
    const tripped = {
      id: 'blocking-guard',
      async processInput(): Promise<never> {
        throw new TripWire('out of scope', { retry: false });
      },
    };
    const traced = tracedProcessor(tripped);
    const trace = openChatTrace('probe');

    const error = await runWithChatTrace(trace, () =>
      traced.processInput().then(
        () => null,
        (e: unknown) => e
      )
    );
    expect(error).toBeInstanceOf(TripWire);
    expect(lines.some(line => line.includes('· blocking-guard block'))).toBe(true);
  });
});

describe('requestTrace middleware (Hono in-process)', () => {
  function buildApp(): Hono {
    const app = new Hono();
    app.use('*', requestTrace as unknown as HonoMiddleware);
    app.post('/chat/:agentId', () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'));
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    );
    app.post('/hooks/x', () => new Response('{"ok":true}', { status: 200 }));
    return app;
  }

  it('traces the whole /chat request: entry (agent/msgs/thread), TTFB, first byte, close + header', async () => {
    vi.stubEnv('CHAT_TRACE', 'on');
    const app = buildApp();
    const response = await app.fetch(
      new Request('http://localhost/chat/comms', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'abc12345-0000-0000' },
        body: JSON.stringify({ messages: [{ id: 'm1' }], memory: { thread: 'nuevo-9c1d' } }),
      })
    );

    await response.text(); // drain the wrapped stream so the close line is emitted

    expect(response.headers.get('x-mastra-trace')).toBe('abc12345');
    expect(lines.some(line => line.includes('→ POST /chat/comms msgs=1 thread=nuevo-9c1d'))).toBe(true);
    expect(lines.some(line => line.includes('← 200 ttfb='))).toBe(true);
    expect(lines.some(line => line.includes('✓ done') && line.includes('first-byte='))).toBe(true);
  });

  it('does not touch non-chat routes', async () => {
    vi.stubEnv('CHAT_TRACE', 'on');
    const app = buildApp();
    const response = await app.fetch(new Request('http://localhost/hooks/x', { method: 'POST' }));
    await response.text();

    expect(lines).toHaveLength(0);
    expect(response.headers.get('x-mastra-trace')).toBeNull();
  });

  it('with CHAT_TRACE=off it stays inert', async () => {
    vi.stubEnv('CHAT_TRACE', 'off');
    const app = buildApp();
    const response = await app.fetch(
      new Request('http://localhost/chat/comms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ id: 'm1' }] }),
      })
    );
    await response.text();

    expect(lines).toHaveLength(0);
    expect(response.headers.get('x-mastra-trace')).toBeNull();
  });
});

describe('trace context', () => {
  it('currentChatTrace is visible to code running inside runWithChatTrace', async () => {
    const trace = openChatTrace('comms');
    expect(currentChatTrace()).toBeUndefined();
    await runWithChatTrace(trace, async () => {
      expect(currentChatTrace()?.agentId).toBe('comms');
    });
    expect(currentChatTrace()).toBeUndefined();
  });
});
