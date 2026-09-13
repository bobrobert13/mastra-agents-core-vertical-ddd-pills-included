import { Mastra } from '@mastra/core/mastra';

import { buildInfrastructure } from './shared/config/infrastructure';
import { detectSchedules } from './shared/config/schedules';
import { logServiceAvailability } from './shared/config/service-status';
import { VECTOR_STORE_NAME } from './shared/config/vectors';

// Import domains
import { researchAgent, deepResearchWorkflow } from './domains/research';
import { taskManagementAgent, dailyDigestWorkflow } from './domains/task-management';
import { fileOperationsAgent } from './domains/file-operations';
import { communicationAgent } from './domains/communication';
import { indexKnowledgeWorkflow, knowledgeQueryTool } from './domains/knowledge';

// All infrastructure is optional and driven by env vars (see shared/config/infrastructure.ts)
const { storage, vectors, observability, pubsub, auth, services } = buildInfrastructure();

// NOTE: the `server` object literal must contain NO local identifiers —
// `mastra dev` statically extracts this literal into a standalone
// .mastra/output/server-config.mjs where locals are out of scope
// (a spread like `...(auth && { auth })` breaks dev boot with
// "auth is not defined"). Attach auth imperatively instead.
const serverConfig: Record<string, unknown> = {
  port: parseInt(process.env.MASTRA_PORT || '4111', 10),
  host: process.env.MASTRA_HOST || '0.0.0.0',
};
if (auth) serverConfig.auth = auth;

export const mastra = new Mastra({
  // fastembed ships platform .node binaries; the bundlers (esp. worker build)
  // cannot analyze them — keep them external (resolved from node_modules at runtime)
  bundler: {
    externals: ['@anush008/tokenizers'],
  },
  agents: {
    research: researchAgent,
    tasks: taskManagementAgent,
    files: fileOperationsAgent,
    comms: communicationAgent,
  },
  workflows: {
    'deep-research': deepResearchWorkflow,
    'daily-digest': dailyDigestWorkflow,
    'index-knowledge': indexKnowledgeWorkflow,
  },
  // null-safe spreads (spec 03 §3.9): the store follows DATABASE_URL/LIBSQL_URL;
  // the knowledge tool is null when no embedder is available (degrade, never crash)
  ...(vectors.store && { vectors: { [VECTOR_STORE_NAME]: vectors.store } }),
  ...(knowledgeQueryTool && { tools: { search_knowledge: knowledgeQueryTool } }),
  storage,
  ...(observability && { observability }),
  ...(pubsub && { pubsub }),
  server: serverConfig,
});

detectSchedules(services, mastra);
logServiceAvailability(services);
