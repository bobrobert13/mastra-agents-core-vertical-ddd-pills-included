import { RedisStreamsPubSub } from '@mastra/redis-streams';
import type { PubSub } from '@mastra/core/events'; // re-export verified in core dist events/index.d.ts
import type { ServiceRegistry } from './service-status';

/**
 * PubSub selection (fully optional):
 *   REDIS_URL → RedisStreamsPubSub (distributed: split workers + event-bus bridge)
 *   nothing   → undefined → Mastra's default EventEmitterPubSub (in-process)
 */
export function buildPubsub(services: ServiceRegistry): PubSub | undefined {
  const url = process.env.REDIS_URL;
  if (!url) {
    services.push({
      name: 'PubSub',
      active: false,
      detail: 'in-process (EventEmitterPubSub) — split workers unavailable',
    });
    return undefined;
  }
  services.push({
    name: 'PubSub',
    active: true,
    detail: 'Redis Streams (REDIS_URL) — distributed',
  });
  // Static import of RedisStreamsPubSub at module top is intended (the package ships with the app bundle).
  // Constructor options left at defaults: keyPrefix 'mastra:topic', maxDeliveryAttempts 5,
  // reclaimIntervalMs 30000, reclaimIdleMs 60000. Any non-empty REDIS_URL is opt-in; constructor
  // errors surface as a loud startup failure (fail-fast only for present-and-invalid).
  return new RedisStreamsPubSub({ url });
}
