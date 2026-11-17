// Mastra PubSub: https://mastra.ai/docs/server/pubsub
import type { PubSub } from '@mastra/core/events';
import { RedisStreamsPubSub } from '@mastra/redis-streams';

export function buildPubsub(): PubSub | undefined {
  const url = process.env.REDIS_URL?.trim();
  return url ? new RedisStreamsPubSub({ url }) : undefined;
}
