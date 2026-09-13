import { EventEmitter } from 'events';
import type { PubSub } from '@mastra/core/events';
import { logger } from '../logger';

/**
 * Domain Event Bus for cross-domain communication
 * Implements pub/sub pattern for domain events
 */
class DomainEventBus extends EventEmitter {
  private static instance: DomainEventBus;

  /** Outbound seam set by the pubsub bridge; undefined = single-process bus. */
  private _outbound?: (e: { type: string; payload: unknown }) => void;

  private constructor() {
    super();
    this.setMaxListeners(100); // Allow many listeners
  }

  static getInstance(): DomainEventBus {
    if (!DomainEventBus.instance) {
      DomainEventBus.instance = new DomainEventBus();
    }
    return DomainEventBus.instance;
  }

  /**
   * Publish an event to the bus
   */
  async publish<T>(event: T): Promise<void> {
    const eventType = (event as { type?: string }).type;
    if (!eventType) {
      throw new Error('Event must have a "type" property');
    }

    this.emit(eventType, event);

    // Bridge seam: fire-and-forget outbound fan-out (never affects local sync emit).
    this._outbound?.({ type: eventType, payload: (event as { payload?: unknown }).payload });
  }

  /** Internal: install/remove the outbound fan-out function (bridge only, not public API). */
  _setOutbound(fn: ((e: { type: string; payload: unknown }) => void) | undefined): void {
    this._outbound = fn;
  }

  /** Internal: deliver an event received from another process. emit() only — never re-publishes. */
  _inbound(event: { type: string; payload: unknown }): void {
    this.emit(event.type, event);
  }

  /**
   * Subscribe to an event type
   */
  subscribe<T>(eventType: string, handler: (event: T) => void | Promise<void>): () => void {
    this.on(eventType, handler);

    // Return unsubscribe function
    return () => {
      this.off(eventType, handler);
    };
  }

  /**
   * Subscribe to an event type once
   */
  subscribeOnce<T>(eventType: string, handler: (event: T) => void | Promise<void>): () => void {
    this.once(eventType, handler);

    return () => {
      this.off(eventType, handler);
    };
  }

  /**
   * Clear all listeners for an event type
   */
  clearListeners(eventType?: string): void {
    if (eventType) {
      this.removeAllListeners(eventType);
    } else {
      this.removeAllListeners();
    }
  }
}

export const eventBus = DomainEventBus.getInstance();

// ── Cross-process bridge (ADR-005 / Spec 02) ────────────────────────────────
// REAL core contract (verified in dist): PubSub.publish(topic, event: Omit<Event,'id'|'createdAt'>, opts?)
// and EventCallback receives a full Event — so the domain {type,payload} rides inside Event.data
// (dist/events/types.d.ts: Event = { type; id; data; runId; createdAt; index?; deliveryAttempt? }).
export const DOMAIN_EVENTS_TOPIC = 'domain.events'; // stream key: mastra:topic:domain.events
const DOMAIN_EVENT_TYPE = 'domain.event'; // Event.type carrier for all bridged traffic

interface BridgedData {
  origin: string;
  domainType: string;
  payload: unknown;
}

const INSTANCE_ID = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Wire the domain event bus onto a distributed PubSub backend.
 * No-op when pubsub is undefined (zero-config: bus stays a plain EventEmitter,
 * single-process guarantee — see ADR-005).
 */
export function attachEventBusBridge(pubsub?: PubSub): void {
  if (!pubsub) return; // zero-config: bus stays plain EventEmitter

  const outbound = (e: { type: string; payload: unknown }) =>
    void pubsub.publish(DOMAIN_EVENTS_TOPIC, {
      type: DOMAIN_EVENT_TYPE,
      runId: INSTANCE_ID, // required string field; doubles as origin
      data: { origin: INSTANCE_ID, domainType: e.type, payload: e.payload } satisfies BridgedData,
    });

  eventBus._setOutbound(outbound);

  // NO group → private consumer group → every process receives every event (fan-out, ref redis-streams subscribe doc)
  void pubsub.subscribe(DOMAIN_EVENTS_TOPIC, (event, ack) => {
    try {
      const data = event.data as BridgedData | undefined;
      if (!data || typeof data.domainType !== 'string') {
        // malformed → logged + dropped, never thrown into the bus
        logger.warn('[event-bus-bridge] dropped malformed inbound event:', event?.id);
        return;
      }
      if (data.origin === INSTANCE_ID) return; // echo guard: local listener already fired
      eventBus._inbound({ type: data.domainType, payload: data.payload });
    } finally {
      // EVERY delivery must be ack'd — including guard/drop paths — or the Redis PEL grows and the
      // reclaim loop redelivers up to maxDeliveryAttempts, multiplying duplicate fan-out
      // (core EventCallback contract, dist/events/types.d.ts:96-101). The bridge has no nack path.
      void ack?.();
    }
  });
}
