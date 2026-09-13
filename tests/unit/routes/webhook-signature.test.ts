import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import {
  computeSignature,
  verifySignature,
  requireSignedRequest,
} from '../../../src/mastra/routes/middleware/webhook-signature';

const SECRET = 'whsec_test_secret';
const BODY = '{"event":"payment.succeeded","data":{"amount":42}}';
// Golden vector — computed independently with node:crypto, pinned here so a
// refactor of computeSignature can never silently change the wire contract.
const GOLDEN = 'sha256=674fd4e57422c4f09d38b319b32783c7b03b7374e9046422b2073c49128aebb8';
const GOLDEN_EMPTY = 'sha256=9e402917284946302bbda3be03ba5f9859d2745280066f88178145ad908ff098';

type Ctx = Parameters<ReturnType<typeof requireSignedRequest>>[0];
type Next = Parameters<ReturnType<typeof requireSignedRequest>>[1];

function makeContext(body: string, signature?: string) {
  const headers: Record<string, string> = {};
  if (signature !== undefined) headers['x-webhook-signature'] = signature;
  const vars: Record<string, unknown> = {};
  const jsonCalls: Array<{ body: unknown; status: number }> = [];
  let reads = 0;
  const c = {
    req: {
      header: (name: string) => headers[name.toLowerCase()],
      text: async () => {
        reads += 1;
        return body;
      },
    },
    json: (payload: unknown, status?: number) => {
      jsonCalls.push({ body: payload, status: status ?? 200 });
      return new Response(JSON.stringify(payload), { status: status ?? 200 });
    },
    set: (key: string, value: unknown) => {
      vars[key] = value;
    },
    get: (key: string) => vars[key],
  };
  return { c: c as unknown as Ctx, jsonCalls, vars, textReads: () => reads };
}

afterEach(() => vi.unstubAllEnvs());

describe('computeSignature / verifySignature (golden vectors)', () => {
  it('matches the pinned HMAC-SHA256 golden vectors', () => {
    expect(computeSignature(BODY, SECRET)).toBe(GOLDEN);
    expect(computeSignature('{}', 'secret123')).toBe(GOLDEN_EMPTY);
    // cross-check against a raw node:crypto call (the reference implementation)
    const raw = 'sha256=' + createHmac('sha256', 'other').update(BODY, 'utf8').digest('hex');
    expect(computeSignature(BODY, 'other')).toBe(raw);
  });

  it('accepts a correctly signed body and rejects a tampered body', () => {
    expect(verifySignature(BODY, GOLDEN, SECRET)).toBe(true);
    expect(verifySignature(BODY.replace('42', '43'), GOLDEN, SECRET)).toBe(false);
  });

  it('rejects wrong secret / missing / malformed headers', () => {
    expect(verifySignature(BODY, GOLDEN, 'wrong_secret')).toBe(false);
    expect(verifySignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifySignature(BODY, '', SECRET)).toBe(false);
    expect(verifySignature(BODY, 'not-a-signature', SECRET)).toBe(false); // wrong shape (length guard)
    expect(
      verifySignature(
        BODY,
        'sha256=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
        SECRET
      )
    ).toBe(false);
    expect(verifySignature(BODY, GOLDEN.slice(0, -1), SECRET)).toBe(false); // truncated hex
    expect(verifySignature(BODY, GOLDEN + 'aa', SECRET)).toBe(false); // extended hex
  });

  it('verifies a 64 KB body quickly (loose bound: 100 iterations < 500 ms)', () => {
    const big = JSON.stringify({ event: 'bulk', data: { blob: 'x'.repeat(64 * 1024) } });
    const sig = computeSignature(big, SECRET);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) expect(verifySignature(big, sig, SECRET)).toBe(true);
    const total = performance.now() - t0;
    // Spec 08 Phase 5: ≤ ~1 ms per 64 KB verify — asserted as a loose CI-tolerant bound.
    // 500 ms (5 ms/verify) after observed flakes at 135-218 ms under concurrent load.
    expect(total).toBeLessThan(500);
  });
});

describe('requireSignedRequest() middleware', () => {
  it('valid signature admits the request: next() called, no response, body read exactly once', async () => {
    vi.stubEnv('WEBHOOK_SECRET', SECRET);
    const { c, jsonCalls, textReads } = makeContext(BODY, GOLDEN);
    const next = vi.fn(async () => {});
    await requireSignedRequest()(c, next as unknown as Next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(jsonCalls).toHaveLength(0);
    // 08-1 approved alternative: NO custom context variable — the middleware
    // reads c.req.text() once and the handler's re-read hits Hono's cache.
    expect(textReads()).toBe(1);
  });

  it('absent / malformed / wrong-secret signatures all yield the identical 401 and never next()', async () => {
    vi.stubEnv('WEBHOOK_SECRET', SECRET);
    const variants = [undefined, 'sha256=deadbeef', computeSignature(BODY, 'other_secret')];
    const bodies = new Set<string>();
    for (const sig of variants) {
      const { c, jsonCalls, vars } = makeContext(BODY, sig);
      const next = vi.fn(async () => {});
      await requireSignedRequest()(c, next as unknown as Next);
      expect(next).not.toHaveBeenCalled();
      expect(jsonCalls).toHaveLength(1);
      expect(jsonCalls[0].status).toBe(401);
      expect(JSON.stringify(jsonCalls[0].body)).toBe('{"error":"invalid webhook signature"}');
      expect(vars['webhook.raw']).toBeUndefined();
      bodies.add(JSON.stringify(jsonCalls[0].body));
    }
    expect(bodies.size).toBe(1); // byte-identical across variants — no oracle
  });

  it('unset WEBHOOK_SECRET short-circuits to the same 401 (fail-closed, route present)', async () => {
    vi.stubEnv('WEBHOOK_SECRET', '');
    const { c, jsonCalls } = makeContext(BODY, GOLDEN); // even a correctly signed request is rejected
    const next = vi.fn(async () => {});
    await requireSignedRequest()(c, next as unknown as Next);
    expect(next).not.toHaveBeenCalled();
    expect(jsonCalls[0].status).toBe(401);
    expect(JSON.stringify(jsonCalls[0].body)).toBe('{"error":"invalid webhook signature"}');
  });
});
