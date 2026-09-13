import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createRateLimiter,
  readRateLimitConfig,
} from '../../../src/mastra/routes/middleware/rate-limit';

type Ctx = Parameters<ReturnType<typeof createRateLimiter>>[0];
type Next = Parameters<ReturnType<typeof createRateLimiter>>[1];

function makeContext(xff?: string) {
  const headers: Record<string, string> = {};
  if (xff !== undefined) headers['x-forwarded-for'] = xff;
  const jsonCalls: Array<{ body: unknown; status: number; headers: Headers }> = [];
  const c = {
    req: { header: (name: string) => headers[name.toLowerCase()] },
    json: (payload: unknown, status?: number) => {
      const response = new Response(JSON.stringify(payload), { status: status ?? 200 });
      jsonCalls.push({ body: payload, status: status ?? 200, headers: response.headers });
      return response;
    },
  };
  return { c: c as unknown as Ctx, jsonCalls };
}

afterEach(() => vi.unstubAllEnvs());

describe('readRateLimitConfig', () => {
  it('enabled only when BOTH vars are valid ints > 0', () => {
    expect(readRateLimitConfig({})).toEqual({ enabled: false, windowMs: 0, max: 0 });
    expect(readRateLimitConfig({ RATE_LIMIT_WINDOW_MS: '1000' }).enabled).toBe(false);
    expect(readRateLimitConfig({ RATE_LIMIT_MAX_REQUESTS: '5' }).enabled).toBe(false);
    expect(readRateLimitConfig({ RATE_LIMIT_WINDOW_MS: '0', RATE_LIMIT_MAX_REQUESTS: '5' }).enabled).toBe(false);
    expect(readRateLimitConfig({ RATE_LIMIT_WINDOW_MS: '-5', RATE_LIMIT_MAX_REQUESTS: '5' }).enabled).toBe(false);
    expect(readRateLimitConfig({ RATE_LIMIT_WINDOW_MS: 'abc', RATE_LIMIT_MAX_REQUESTS: '5' }).enabled).toBe(false);
    expect(readRateLimitConfig({ RATE_LIMIT_WINDOW_MS: '60000', RATE_LIMIT_MAX_REQUESTS: '100' })).toEqual({
      enabled: true,
      windowMs: 60000,
      max: 100,
    });
  });
});

describe('createRateLimiter (fake clock, fixed window)', () => {
  it('is a no-op passthrough when vars are unset or partial (zero-config unchanged)', async () => {
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '');
    vi.stubEnv('RATE_LIMIT_MAX_REQUESTS', '');
    const mw = createRateLimiter();
    for (let i = 0; i < 20; i++) {
      const { c, jsonCalls } = makeContext('203.0.113.1');
      const next = vi.fn();
      await mw(c, next as unknown as Next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(jsonCalls).toHaveLength(0);
    }
    // partial config: still off
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '1000');
    const { c, jsonCalls } = makeContext();
    const next = vi.fn();
    await createRateLimiter()(c, next as unknown as Next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(jsonCalls).toHaveLength(0);
  });

  it('N pass, N+1 → 429 with exact body + Retry-After; window reset re-admits', async () => {
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '1000');
    vi.stubEnv('RATE_LIMIT_MAX_REQUESTS', '3');
    let clock = 1_000_000;
    const mw = createRateLimiter({ now: () => clock });
    const next = vi.fn();

    for (let i = 0; i < 3; i++) {
      const { c, jsonCalls } = makeContext('203.0.113.7, 10.0.0.1');
      await mw(c, next as unknown as Next);
      expect(jsonCalls).toHaveLength(0);
    }
    const blocked = makeContext('203.0.113.7, 10.0.0.1');
    await mw(blocked.c, next as unknown as Next);
    expect(blocked.jsonCalls).toHaveLength(1);
    expect(blocked.jsonCalls[0].status).toBe(429);
    expect(JSON.stringify(blocked.jsonCalls[0].body)).toBe('{"error":"rate limit exceeded"}');
    expect(blocked.jsonCalls[0].headers.get('Retry-After')).toBe('1');
    expect(next).toHaveBeenCalledTimes(3); // the 429 never reached next

    // mid-window still blocked
    clock += 999;
    const still = makeContext('203.0.113.7');
    await mw(still.c, next as unknown as Next);
    expect(still.jsonCalls[0]?.status).toBe(429);

    // past the window boundary → fresh window admits again
    clock += 1;
    const reset = makeContext('203.0.113.7');
    await mw(reset.c, next as unknown as Next);
    expect(reset.jsonCalls).toHaveLength(0);
    expect(next).toHaveBeenCalledTimes(4);
  });

  it('keys on the FIRST XFF hop, falls back to "local"; keys are isolated', async () => {
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '1000');
    vi.stubEnv('RATE_LIMIT_MAX_REQUESTS', '1');
    const mw = createRateLimiter();
    const a1 = makeContext('198.51.100.1, 10.0.0.1');
    await mw(a1.c, (async () => {}) as unknown as Next);
    const a2 = makeContext('198.51.100.1, 10.0.0.2'); // same first hop → blocked
    await mw(a2.c, (async () => {}) as unknown as Next);
    expect(a2.jsonCalls[0]?.status).toBe(429);
    const b = makeContext('198.51.100.2'); // different client → unaffected
    await mw(b.c, (async () => {}) as unknown as Next);
    expect(b.jsonCalls).toHaveLength(0);
    const l1 = makeContext(); // no header → 'local' bucket
    await mw(l1.c, (async () => {}) as unknown as Next);
    const l2 = makeContext();
    await mw(l2.c, (async () => {}) as unknown as Next);
    expect(l2.jsonCalls[0]?.status).toBe(429);
  });
});
