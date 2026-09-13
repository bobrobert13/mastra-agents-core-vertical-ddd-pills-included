import { describe, it, expect, afterEach } from 'vitest';
import { RedisStreamsPubSub } from '@mastra/redis-streams';
import { buildPubsub } from '../../../../src/mastra/shared/config/pubsub';
import type { ServiceRegistry } from '../../../../src/mastra/shared/config/service-status';

const saved = process.env.REDIS_URL;

afterEach(() => {
  if (saved === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = saved;
});

describe('buildPubsub', () => {
  it('returns undefined and reports in-process default when REDIS_URL is unset', () => {
    delete process.env.REDIS_URL;
    const services: ServiceRegistry = [];

    const pubsub = buildPubsub(services);

    expect(pubsub).toBeUndefined();
    expect(services).toHaveLength(1);
    expect(services[0]).toEqual({
      name: 'PubSub',
      active: false,
      detail: 'in-process (EventEmitterPubSub) — split workers unavailable',
    });
  });

  it('returns a RedisStreamsPubSub and reports distributed when REDIS_URL is set', async () => {
    // Unreachable URL is fine: constructor is lazy, no connection asserted.
    process.env.REDIS_URL = 'redis://localhost:6399';
    const services: ServiceRegistry = [];

    const pubsub = buildPubsub(services);
    try {
      expect(pubsub).toBeInstanceOf(RedisStreamsPubSub);
      expect(services).toHaveLength(1);
      expect(services[0]).toEqual({
        name: 'PubSub',
        active: true,
        detail: 'Redis Streams (REDIS_URL) — distributed',
      });
    } finally {
      if (pubsub) await (pubsub as RedisStreamsPubSub).close();
    }
  });
});
