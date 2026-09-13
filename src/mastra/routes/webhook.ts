import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';

import { eventBus } from '../shared/events';
import type { InboundWebhookEvent } from '../shared/events';
import { createRateLimiter } from './middleware/rate-limit';
import { requireSignedRequest } from './middleware/webhook-signature';

const webhookBodySchema = z.object({
  event: z.string().min(1).max(128),
  data: z.record(z.unknown()),
});

/** Contract: `x-webhook-signature: sha256=<64 lowercase hex>` over raw bytes. */
export interface WebhookHeaders {
  'x-webhook-signature'?: string;
}

/**
 * Inbound signed webhook → exactly one `webhook.received` on the domain bus.
 *
 * ROOT-LEVEL path on purpose: Mastra 1.66 hard-throws at boot for any custom
 * route starting with `apiPrefix` (`/api`) — `validateCustomRoutePaths()` in
 * @mastra/server, spec 08 §3.0. The handler executes NO domain logic itself
 * (vertical-slice rule); side effects belong to whichever domain subscribes.
 *
 * Route-level middleware because GLOBAL `server.middleware` is skipped on
 * `requiresAuth: false` routes: limiter first (cheap reject), HMAC second.
 * Without `WEBHOOK_SECRET` the route stays REGISTERED but fail-closed 401 —
 * degrading safely, never degrading open (spec 08 §3.0).
 */
export const webhookRoute = registerApiRoute('/hooks/:source', {
  method: 'POST',
  requiresAuth: false, // inbound systems hold no JWT (Spec 01) — HMAC is the auth
  middleware: [createRateLimiter(), requireSignedRequest()],
  handler: async c => {
    // Raw bytes re-read here is the 08-1 approved alternative (see
    // middleware/types.ts): the signature middleware already consumed the
    // body once and Hono caches it, so this is still ONE underlying read.
    const raw = await c.req.text();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid webhook payload' }, 400);
    }
    const parsed = webhookBodySchema.safeParse(json);
    if (!parsed.success) return c.json({ error: 'invalid webhook payload' }, 400);

    const event: InboundWebhookEvent = {
      type: 'webhook.received',
      payload: {
        source: c.req.param('source'),
        event: parsed.data.event,
        data: parsed.data.data,
        receivedAt: new Date(),
      },
    };
    await eventBus.publish(event); // local bus now; Spec 02's bridge fans out cross-process
    return c.json({ received: true, source: event.payload.source, type: 'webhook.received' });
  },
  openapi: { summary: 'Inbound signed webhook', tags: ['Webhooks'] },
});
