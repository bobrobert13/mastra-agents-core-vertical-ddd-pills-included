// Real-Redis round-trip through the event-bus bridge. Gated so the tier skips
// cleanly in env-less runs (pattern per tests/AGENTS.md); CI test-integration
// provides a redis:7-alpine service + REDIS_URL (see .artifacts/integration-brief-02.md).
import { describe, it, expect, afterAll } from 'vitest';
import { RedisStreamsPubSub } from '@mastra/redis-streams';
import {
  eventBus,
  attachEventBusBridge,
  DOMAIN_EVENTS_TOPIC,
} from '../../src/mastra/shared/events/event-bus';

const url = process.env.REDIS_URL;
describe.skipIf(!url)('event-bus bridge over real Redis Streams', () => {
  // Two pubsubs = two "processes" in one test file. The echo guard keys off the
  // module-level INSTANCE_ID, so we attach the bridge to ONE side only and use
  // the other side to impersonate a remote publisher/subscriber.
  const local = new RedisStreamsPubSub({ url: url! });
  const remote = new RedisStreamsPubSub({ url: url! });

  afterAll(async () => {
    eventBus._setOutbound(undefined);
    await local.clearTopic(DOMAIN_EVENTS_TOPIC);
    await local.close();
    await remote.close();
  });

  const waitFor = async (predicate: () => boolean, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (predicate()) return;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('timed out waiting for Redis delivery');
  };

  it('publishes through the bridge to a remote subscriber (fan-out, JSON round-trip)', async () => {
    attachEventBusBridge(local);
    const seen: Array<{ type: string; data: unknown }> = [];
    await remote.subscribe(DOMAIN_EVENTS_TOPIC, (event, ack) => {
      seen.push({ type: event.type, data: event.data });
      void ack?.();
    });

    await eventBus.publish({
      type: 'research.completed',
      payload: { finishedAt: new Date(0), topic: 'redis' },
    });

    await waitFor(() =>
      seen.some(
        s => (s.data as { domainType?: string }).domainType === 'research.completed'
      )
    );
    const bridged = seen.find(
      s => (s.data as { domainType?: string }).domainType === 'research.completed'
    )!;
    expect(bridged.type).toBe('domain.event');
    const data = bridged.data as { origin: string; domainType: string; payload: { finishedAt: unknown } };
    expect(typeof data.origin).toBe('string');
    // Declared limitation: payload is JSON round-tripped — Date arrives as ISO string.
    expect(data.payload.finishedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('delivers an inbound remote event to local listeners with ack (at-least-once)', async () => {
    const received: unknown[] = [];
    const unsub = eventBus.subscribe('task.assigned', e => { received.push(e); });

    await remote.publish(DOMAIN_EVENTS_TOPIC, {
      type: 'domain.event',
      runId: 'remote-pid-1',
      data: { origin: 'remote-pid-1', domainType: 'task.assigned', payload: { id: 7 } },
    });

    await waitFor(() => received.length > 0);
    // The bridge subscribes without a group → fan-out: our own subscribe above
    // also sees this event; assert on the entry that reached the bus.
    expect(received[0]).toEqual({ type: 'task.assigned', payload: { id: 7 } });
    unsub();
  });
});
