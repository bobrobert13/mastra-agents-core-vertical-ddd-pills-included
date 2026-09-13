import type { Observability } from '@mastra/observability';
import type { PubSub } from '@mastra/core/events';
import { buildStorage, type Storage } from './storage';
import { buildObservability } from './observability';
import { buildPubsub } from './pubsub';
import { buildAuth, type AuthConfig } from './auth';
import { buildVectors, type VectorResolution } from './vectors';
import type { MCPClient } from '@mastra/mcp';
import { buildMcpClient } from './mcp';
import { attachEventBusBridge } from '../events';
import { detectModelProviders, detectScopeGuard, hasAnyProviderKey } from './providers';
import type { ServiceStatus, ServiceRegistry } from './service-status';

export type { ServiceStatus } from './service-status';
export type { Storage } from './storage';

export interface Infrastructure {
  storage: Storage;
  observability?: Observability;
  pubsub?: PubSub;
  auth?: AuthConfig;
  vectors: VectorResolution;
  mcpClient?: MCPClient;
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
  const vectors = buildVectors(services);
  const observability = buildObservability(services);
  const pubsub = buildPubsub(services);
  attachEventBusBridge(pubsub);
  const auth = buildAuth(services);
  const { client: mcpClient } = buildMcpClient(services); // throws on set-but-invalid MCP_SERVERS (fail-fast, spec 04 Sc.2)
  detectModelProviders(services);
  detectScopeGuard(services, hasAnyProviderKey());

  return { storage, vectors, observability, pubsub, auth, mcpClient, services };
}
