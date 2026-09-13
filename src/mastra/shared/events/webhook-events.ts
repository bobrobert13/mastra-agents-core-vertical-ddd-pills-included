/**
 * Inbound webhook envelope (spec 08 §3.4).
 *
 * Lives in `shared/events/` because NO domain may be imported by the webhook
 * route (vertical-slice rule, ADR-001) and no single domain owns this
 * envelope: domains SUBSCRIBE and map it to their own typed events.
 *
 * The route guarantees "every inbound HTTP integration lands on the
 * `eventBus` as exactly one `webhook.received`" (local emit today; Spec 02's
 * Redis bridge turns this exact publish into the cross-process fan-out).
 */
export interface InboundWebhookEvent {
  type: 'webhook.received';
  payload: {
    source: string;
    event: string;
    data: Record<string, unknown>;
    receivedAt: Date;
  };
}

/** Event-bus topic string for subscribers (`eventBus.subscribe(WEBHOOK_RECEIVED, …)`). */
export const WEBHOOK_RECEIVED = 'webhook.received' as const;
