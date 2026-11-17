import type { PubSub } from '@mastra/core/events';
import type { Observability } from '@mastra/observability';
import type { MCPClient } from '@mastra/mcp';
import { buildAuth, type AuthConfig } from './auth';
import { buildMcpClient } from './mcp';
import { buildObservability } from './observability';
import { buildPubsub } from './pubsub';
import { buildStorage, type Storage } from './storage';
import { resolveVectors, type VectorResolution } from './vectors';

export interface Infrastructure {
  storage: Storage;
  storageDetail: string;
  vectors: VectorResolution;
  observability?: Observability;
  pubsub?: PubSub;
  auth?: AuthConfig;
  mcpClient?: MCPClient;
}

export function buildInfrastructure(): Infrastructure {
  const storage = buildStorage();
  return {
    storage: storage.storage,
    storageDetail: storage.detail,
    vectors: resolveVectors(),
    observability: buildObservability(),
    pubsub: buildPubsub(),
    auth: buildAuth(),
    mcpClient: buildMcpClient(),
  };
}
