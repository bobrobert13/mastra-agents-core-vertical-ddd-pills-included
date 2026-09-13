import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { mastra } from '../../src/mastra';
import { RequestContext } from '@mastra/core/request-context';
import type { Middleware } from '@mastra/core/server';
import { eventBus } from '../../src/mastra/shared/events';
import type { InboundWebhookEvent } from '../../src/mastra/shared/events';
import type { ServiceRegistry } from '../../src/mastra/shared/config/service-status';
import { buildObservability } from '../../src/mastra/shared/config/observability';
import { buildServerSurface } from '../../src/mastra/routes';
import { computeSignature } from '../../src/mastra/routes/middleware/webhook-signature';

/**
 * Integration tier for the Spec 08 HTTP surface (routes 1–4 + rate-limit
 * burst + OTLP degrade). Gated: RUN_HTTP_TESTS=1 npm run test:integration
 * (tests/AGENTS.md documents the opt-in; a skipped-forever suite is a lying
 * suite — 08-4). Scenario 4 additionally needs a live provider key.
 *
 * HARNESS NOTE (deviation from the spawn-a-server reading of the spec's
 * "server-spawn harness", documented in integration-brief-08): the suite
 * boots the REAL route/middleware/CORS surface in-process on a Hono instance
 * — mounting exactly what `buildServerSurface` hands the composition root.
 * Reasons: (a) the `src/mastra/index.ts` wiring lands at integration merge
 * (wave concurrency), and (b) Scenario 1's eventBus-subscriber assertion is
 * only observable in the publishing process. A spawn-based end-to-end pass
 * against `mastra dev` should be added on top once index.ts wires the
 * surface — same cases, curl-style.
 */

const RUN = process.env.RUN_HTTP_TESTS === '1';
const hasProviderKey = [
  'DEEPINFRA_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
].some(key => process.env[key]?.trim());

const SECRET = 'whsec_test_secret';
const SIGN_BODY = '{"event":"payment.succeeded","data":{"amount":42}}';

type HonoMiddleware = Parameters<Hono['use']>[1];

/**
 * The concrete `registerApiRoute` objects inside the `ApiRoute` union; read
 * through this shape because the union's schema-route variant hides
 * handler/middleware from the type system.
 */
type MountedRoute = {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL';
  requiresAuth?: boolean;
  handler?: unknown;
  middleware?: unknown;
};

function mountSurface(services: ServiceRegistry): Hono {
  const surface = buildServerSurface(services);
  const app = new Hono();

  // Mirror of Mastra's documented server.cors defaults (installed typings
  // JSDoc). Mastra injects these when `cors` is configured — including
  // maxAge 3600 (Scenario 3) — and merges the user's `origin` allow-list.
  const defaults = {
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'A2A-Version',
      'x-mastra-client-type',
      'x-mastra-dev-playground',
      'x-webhook-signature',
    ],
    exposeHeaders: ['Content-Length', 'X-Requested-With'],
    maxAge: 3600,
    credentials: false,
  };
  // `as` bridge: the surface's CorsOptions comes from @mastra's BUNDLED hono
  // copy; only the plain origin list crosses over here (harness glue).
  const origin = ((surface.cors?.origin as string | string[] | undefined) ?? '*') as
    string | string[];
  app.use('*', cors({ ...defaults, origin }));

  // framework glue the real server provides before custom handlers run
  app.use('*', (async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>
  ) => {
    c.set('mastra', mastra);
    c.set('requestContext', new RequestContext());
    await next();
  }) as unknown as HonoMiddleware);

  for (const m of surface.middleware as Middleware[]) {
    if (typeof m === 'function') app.use('*', m as unknown as HonoMiddleware);
    else {
      const mw = m as { path?: string; handler: Middleware };
      app.use(mw.path ?? '*', mw.handler as unknown as HonoMiddleware);
    }
  }

  // hono's `on` overloads cannot express a dynamically-computed method union;
  // the runtime accepts (METHOD, path, ...handlers) verbatim.
  const on = app.on.bind(app) as (method: string, path: string, ...handlers: unknown[]) => unknown;
  for (const route of surface.apiRoutes as unknown as MountedRoute[]) {
    const handler = route.handler;
    expect(handler, `route ${route.path} must carry a handler`).toBeDefined();
    on(route.method, route.path, ...((route.middleware ?? []) as unknown[]), handler);
  }
  return app;
}

// NOTE: deliberately NO `afterEach(() => vi.unstubAllEnvs())` here — that would
// restore the CALLER's ambient env after the very first test and silently drop
// the suite baseline stubbed in beforeAll (each mutating test restores its own
// vars inline instead).

describe.skipIf(!RUN)('HTTP surface (integration)', () => {
  const services: ServiceRegistry = [];
  let app: Hono;

  beforeAll(() => {
    vi.stubEnv('WEBHOOK_SECRET', SECRET);
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com,https://admin.example.com');
    // limiter deliberately OFF for the functional cases (the burst test flips it on)
    app = mountSurface(services);
  });

  // ── Scenario 1: valid signature → 200 exact shape + subscriber effect ──
  it('POST /hooks/test with a valid HMAC returns the exact 200 and publishes webhook.received', async () => {
    const seen: InboundWebhookEvent[] = [];
    const unsubscribe = eventBus.subscribe<InboundWebhookEvent>('webhook.received', e => {
      seen.push(e);
    });
    try {
      const response = await app.fetch(
        new Request('http://test.local/hooks/test', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-webhook-signature': computeSignature(SIGN_BODY, SECRET),
          },
          body: SIGN_BODY,
        })
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(
        '{"received":true,"source":"test","type":"webhook.received"}'
      );
      expect(seen).toHaveLength(1);
      expect(seen[0].payload.source).toBe('test');
      expect(seen[0].payload.event).toBe('payment.succeeded');
      expect(seen[0].payload.data.amount).toBe(42);
      expect(seen[0].payload.receivedAt).toBeInstanceOf(Date);
    } finally {
      unsubscribe();
    }
  });

  it('malformed JSON or schema-invalid body → 400 exact shape (signed)', async () => {
    for (const body of ['{not json', '{"event":"","data":{}}', '{"data":{}}']) {
      const response = await app.fetch(
        new Request('http://test.local/hooks/test', {
          method: 'POST',
          headers: { 'x-webhook-signature': computeSignature(body, SECRET) },
          body,
        })
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('{"error":"invalid webhook payload"}');
    }
  });

  // ── Scenario 2: bad/missing/wrong/unconfigured → identical 401, never published ──
  it('rejects absent, malformed and wrong-secret signatures with byte-identical 401s', async () => {
    const publishSpy = vi.spyOn(eventBus, 'publish');
    const variants: Array<Record<string, string> | undefined> = [
      undefined,
      { 'x-webhook-signature': 'sha256=nothexatallnothexatallnothexatallnothexatallnothexa12' },
      { 'x-webhook-signature': computeSignature(SIGN_BODY, 'wrong_secret') },
    ];
    const bodies: string[] = [];
    for (const headers of variants) {
      const response = await app.fetch(
        new Request('http://test.local/hooks/test', { method: 'POST', headers, body: SIGN_BODY })
      );
      expect(response.status).toBe(401);
      bodies.push(await response.text());
    }
    expect(bodies).toEqual([
      '{"error":"invalid webhook signature"}',
      '{"error":"invalid webhook signature"}',
      '{"error":"invalid webhook signature"}',
    ]); // no oracle distinguishing missing / malformed / wrong
    expect(publishSpy).not.toHaveBeenCalled();
    publishSpy.mockRestore();
  });

  it('with WEBHOOK_SECRET unset the route stays registered and fail-closes 401 (same body)', async () => {
    vi.stubEnv('WEBHOOK_SECRET', '');
    const publishSpy = vi.spyOn(eventBus, 'publish');
    const response = await app.fetch(
      new Request('http://test.local/hooks/test', {
        method: 'POST',
        headers: { 'x-webhook-signature': computeSignature(SIGN_BODY, SECRET) }, // "valid" against the old secret
        body: SIGN_BODY,
      })
    );
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"error":"invalid webhook signature"}');
    expect(publishSpy).not.toHaveBeenCalled();
    publishSpy.mockRestore();
    vi.stubEnv('WEBHOOK_SECRET', SECRET);
  });

  // ── Scenario 3: CORS preflight decided by CORS_ORIGIN ──
  it('preflight for an allow-listed origin gets ACAO echo + POST + Max-Age 3600', async () => {
    const response = await app.fetch(
      new Request('http://test.local/hooks/test', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.com', 'Access-Control-Request-Method': 'POST' },
      })
    );
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-max-age')).toBe('3600');
  });

  it('preflight for a non-listed origin carries NO ACAO header', async () => {
    const response = await app.fetch(
      new Request('http://test.local/hooks/test', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST' },
      })
    );
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('CORS_ORIGIN unset keeps the permissive "*" default', async () => {
    vi.stubEnv('CORS_ORIGIN', '');
    const bare = mountSurface([]);
    const response = await bare.fetch(
      new Request('http://test.local/hooks/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://anywhere.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })
    );
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com,https://admin.example.com'); // restore baseline
  });

  it('GET /health/version answers with the version shape (public)', async () => {
    const response = await app.fetch(new Request('http://test.local/health/version'));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({ status: 'ok', user: null });
    expect(typeof json.version).toBe('string');
    expect(typeof json.env).toBe('string');
  });

  // ── rate-limit burst (route-level limiter on the public webhook) ──
  it('burst over RATE_LIMIT_MAX_REQUESTS → 429 with Retry-After, then reset window admits', async () => {
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    vi.stubEnv('RATE_LIMIT_MAX_REQUESTS', '5');
    const xff = '192.0.2.44, 10.0.0.1';
    const sig = computeSignature(SIGN_BODY, SECRET);
    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const response = await app.fetch(
        new Request('http://test.local/hooks/burst', {
          method: 'POST',
          headers: { 'x-webhook-signature': sig, 'x-forwarded-for': xff },
          body: SIGN_BODY,
        })
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(200);
    const burst = await app.fetch(
      new Request('http://test.local/hooks/burst', {
        method: 'POST',
        headers: { 'x-webhook-signature': sig, 'x-forwarded-for': xff },
        body: SIGN_BODY,
      })
    );
    expect(burst.status).toBe(429);
    expect(await burst.text()).toBe('{"error":"rate limit exceeded"}');
    expect(Number(burst.headers.get('retry-after'))).toBeGreaterThan(0);
    // a different client is unaffected
    const other = await app.fetch(
      new Request('http://test.local/hooks/burst', {
        method: 'POST',
        headers: { 'x-webhook-signature': sig, 'x-forwarded-for': '192.0.2.45' },
        body: SIGN_BODY,
      })
    );
    expect(other.status).toBe(200);
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '');
    vi.stubEnv('RATE_LIMIT_MAX_REQUESTS', '');
  });

  // ── OTLP degrade: endpoint pointed at a dead port must not take request handling down ──
  it('buildObservability against a dead OTLP port still serves /health/version', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:59999');
    const otlpServices: ServiceRegistry = [];
    expect(() => buildObservability(otlpServices)).not.toThrow();
    const row = otlpServices.find(s => s.name === 'OTLP export');
    expect(row).toBeDefined(); // active (normalized to /v1/traces) or degraded — never a crash
    const otlpApp = mountSurface([]);
    const response = await otlpApp.fetch(new Request('http://test.local/health/version'));
    expect(response.status).toBe(200);
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
  });

  // ── Scenario 4 (also provider-key gated): streaming SSE ──
  describe.skipIf(!hasProviderKey)('streaming (live provider key required)', () => {
    it('POST /stream/research answers as SSE with a first {"type":"start"} frame', async () => {
      const response = await app.fetch(
        new Request('http://test.local/stream/research', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'say hi' }],
            memory: { thread: `http-surface-${Date.now()}`, resource: 'http-surface-test' },
          }),
        })
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type') ?? '').toMatch(/^text\/event-stream/);

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!buffer.includes('\n\n')) {
        const chunk = await reader!.read();
        expect(chunk.done, 'stream ended before the first frame').toBe(false);
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      const firstFrame = buffer.split('\n\n')[0];
      expect(firstFrame.startsWith('data: ')).toBe(true);
      expect(JSON.parse(firstFrame.slice('data: '.length))).toMatchObject({ type: 'start' });
      reader!.cancel().catch(() => undefined);
    }, 120_000);
  });

  it('POST /stream/unknown-agent → 404 with the not-found body (getAgent throws)', async () => {
    const response = await app.fetch(
      new Request('http://test.local/stream/does-not-exist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      })
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('{"error":"agent \\"does-not-exist\\" not found"}');
  });
});
