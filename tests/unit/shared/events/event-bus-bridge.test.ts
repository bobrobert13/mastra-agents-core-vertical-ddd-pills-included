import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PubSub } from '@mastra/core/events';
import {
  eventBus,
  attachEventBusBridge,
  DOMAIN_EVENTS_TOPIC,
} from '../../../../src/mastra/shared/events/event-bus';

interface Published {
  topic: string;
  event: { type: string; runId: string; data: unknown };
}
type Sub = {
  topic: string;
  cb: (event: unknown, ack?: () => Promise<void>, nack?: () => Promise<void>) => void;
};

function createFakePubsub() {
  const published: Published[] = [];
  const subs: Sub[] = [];
  const fake = {
    publish: async (topic: string, event: Published['event']) => {
      published.push({ topic, event });
    },
    subscribe: async (topic: string, cb: Sub['cb']) => {
      subs.push({ topic, cb });
    },
    unsubscribe: async () => {},
    flush: async () => {},
    clearTopic: async () => {},
  };
  return { fake: fake as unknown as PubSub, published, subs };
}

const delivery = (origin: string, domainType: unknown, payload: unknown = {}) => ({
  id: 'evt-1',
  type: 'domain.event',
  runId: origin,
  createdAt: new Date(),
  data: { origin, domainType, payload },
});

describe('event-bus bridge (fake PubSub, deterministic, no Redis)', () => {
  beforeEach(() => {
    eventBus.clearListeners();
    eventBus._setOutbound(undefined);
  });

  afterEach(() => {
    eventBus.clearListeners();
    eventBus._setOutbound(undefined);
  });

  it('attach without pubsub is a no-op (zero-config stays in-process)', async () => {
    attachEventBusBridge(undefined);
    const local: unknown[] = [];
    eventBus.subscribe('a.type', e => {
      local.push(e);
    });

    await eventBus.publish({ type: 'a.type', payload: { x: 1 } });

    expect(local).toHaveLength(1); // bus still works normally
  });

  it('publish forwards a core-contract Event carrying {origin, domainType, payload} in data', async () => {
    const { fake, published, subs } = createFakePubsub();
    attachEventBusBridge(fake);

    expect(subs).toHaveLength(1);
    expect(subs[0].topic).toBe(DOMAIN_EVENTS_TOPIC);
    expect(DOMAIN_EVENTS_TOPIC).toBe('domain.events');

    await eventBus.publish({ type: 'research.completed', payload: { id: 42 } });

    // local sync emit unchanged AND outbound fan-out
    expect(published).toHaveLength(1);
    const { topic, event } = published[0];
    expect(topic).toBe('domain.events');
    expect(event.type).toBe('domain.event'); // carrier type, not the domain type
    expect(typeof event.runId).toBe('string'); // required field; doubles as origin
    const data = event.data as { origin: string; domainType: string; payload: unknown };
    expect(data.domainType).toBe('research.completed');
    expect(data.payload).toEqual({ id: 42 });
    expect(data.origin).toBe(event.runId);
  });

  it('inbound re-emits locally from event.data (remote process event)', async () => {
    const { fake, subs } = createFakePubsub();
    attachEventBusBridge(fake);
    const inbound: unknown[] = [];
    eventBus.subscribe('task.created', e => {
      inbound.push(e);
    });

    const ack = vi.fn(async () => {});
    subs[0].cb(delivery('other-process-1', 'task.created', { t: 1 }), ack);

    expect(inbound).toEqual([{ type: 'task.created', payload: { t: 1 } }]);
    expect(ack).toHaveBeenCalledTimes(1); // ack on EVERY delivery
  });

  it('echo-guarded delivery (own origin) is skipped locally but still acked', async () => {
    const { fake, published, subs } = createFakePubsub();
    attachEventBusBridge(fake);
    await eventBus.publish({ type: 'ping', payload: {} });
    const ownOrigin = (published[0].event.data as { origin: string }).origin;

    const spy = vi.fn();
    eventBus.subscribe('ping', spy);
    const ack = vi.fn(async () => {});
    subs[0].cb(delivery(ownOrigin, 'ping', {}), ack);

    expect(spy).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1); // no PEL backlog from filtered deliveries
  });

  it('malformed deliveries (missing/non-string domainType) are dropped, never thrown, always acked', () => {
    const { fake, subs } = createFakePubsub();
    attachEventBusBridge(fake);
    const spy = vi.fn();
    eventBus.subscribe('whatever', spy);

    const ack1 = vi.fn(async () => {});
    const ack2 = vi.fn(async () => {});
    const ack3 = vi.fn(async () => {});
    expect(() =>
      subs[0].cb({ id: 'x', type: 'domain.event', runId: 'r', createdAt: new Date() }, ack1)
    ).not.toThrow();
    expect(() => subs[0].cb(delivery('remote', undefined, {}), ack2)).not.toThrow();
    expect(() =>
      subs[0].cb(
        {
          id: 'y',
          type: 'domain.event',
          runId: 'r',
          createdAt: new Date(),
          data: { domainType: 123 },
        },
        ack3
      )
    ).not.toThrow();

    expect(spy).not.toHaveBeenCalled();
    expect(ack1).toHaveBeenCalledTimes(1);
    expect(ack2).toHaveBeenCalledTimes(1);
    expect(ack3).toHaveBeenCalledTimes(1);
  });

  it('publish/subscribe call-site API is unchanged (ADR-003 usage compiles untouched)', async () => {
    const local: unknown[] = [];
    const unsub = eventBus.subscribe('legacy.event', e => {
      local.push(e);
    });
    await eventBus.publish({ type: 'legacy.event', payload: { ok: true } });
    unsub();
    await eventBus.publish({ type: 'legacy.event', payload: { ok: false } });
    expect(local).toHaveLength(1);
    expect(eventBus.publish.length).toBe(1);
    expect(eventBus.subscribe.length).toBe(2);
  });
});
