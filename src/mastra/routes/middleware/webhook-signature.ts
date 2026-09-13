import { createHmac, timingSafeEqual } from 'crypto';
import type { RouteMiddleware } from './types';

/**
 * HMAC-SHA256 over the RAW request body (never re-serialized JSON — whitespace
 * changes break signatures, which is why this surface uses `registerApiRoute`
 * + manual parsing instead of the schema-first `createRoute`).
 * Contract: header `x-webhook-signature: sha256=<64 lowercase hex>`.
 */
export function computeSignature(rawBody: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Timing-safe compare on equal-length fixed-shape buffers (`sha256=` + 64 hex
 * = 72 bytes). The length check only rejects off-shape headers, so it leaks
 * nothing meaningful (spec 08 Phase 5 / Security).
 */
export function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(computeSignature(rawBody, secret));
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Route-level middleware for `/hooks/:source` (global `server.middleware` is
 * SKIPPED on `requiresAuth: false` routes — verified in @mastra/core types,
 * `skipIfFrameworkPublic`), so the webhook carries its own guard.
 *
 * Fail-closed, no oracle: `WEBHOOK_SECRET` unset, header absent, malformed or
 * computed with a wrong secret all answer the byte-identical
 * `401 {"error":"invalid webhook signature"}` — and the handler (therefore
 * `eventBus.publish`) never runs.
 *
 * Reads `c.req.text()` ONCE here; Hono's request caches the body, so the
 * handler's re-read is free (spec 08 §3.3 approved alternative, see above).
 */
export function requireSignedRequest(): RouteMiddleware {
  return async (c, next) => {
    const secret = (process.env.WEBHOOK_SECRET ?? '').trim();
    const raw = await c.req.text(); // cached by Hono after this first read
    const signature = c.req.header('x-webhook-signature');

    if (!secret || !verifySignature(raw, signature, secret)) {
      return c.json({ error: 'invalid webhook signature' }, 401);
    }

    await next();
  };
}
