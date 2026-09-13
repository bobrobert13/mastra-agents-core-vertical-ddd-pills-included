import type { Observability } from '@mastra/observability';
import type { PubSub } from '@mastra/core/events';
import { buildStorage, type Storage } from './storage';
import { buildObservability } from './observability';
import { buildPubsub } from './pubsub';
import { attachEventBusBridge } from '../events';
import { detectModelProviders, detectScopeGuard, hasAnyProviderKey } from './providers';
import type { ServiceStatus, ServiceRegistry } from './service-status';

export type { ServiceStatus } from './service-status';
export type { Storage } from './storage';

export interface Infrastructure {
  storage: Storage;
  observability?: Observability;
  pubsub?: PubSub;
  services: ServiceStatus[];
}

/**
 * Composition root for all env-optional infrastructure.
 * Rule: if the env var exists the service activates; if not, nothing throws
 * and the app keeps working (zero-config dev mode). Each service builder
 * lives in its own module; this file only composes them.
 */
export function buildInfrastructure(): Infrastructure {
  const services: ServiceRegistry = [];

  const storage = buildStorage(services);
  const observability = buildObservability(services);
  const pubsub = buildPubsub(services);
  attachEventBusBridge(pubsub);
  detectModelProviders(services);
  detectScopeGuard(services, hasAnyProviderKey());

  return { storage, observability, pubsub, services };
}
