import { Mastra } from '@mastra/core/mastra';

import { validateEnv } from './shared/config/env';
import { buildInfrastructure } from './shared/config/infrastructure';
import { detectSchedules } from './shared/config/schedules';
import { logServiceAvailability } from './shared/config/service-status';
import { VECTOR_STORE_NAME } from './shared/config/vectors';
import { buildMcpServer } from './mcp/server';
import { buildServerSurface } from './routes';
import { buildEvalScorers } from './shared/evals';

// Import domains
import { researchAgent, deepResearchWorkflow } from './domains/research';
import { taskManagementAgent, dailyDigestWorkflow } from './domains/task-management';
import { fileOperationsAgent } from './domains/file-operations';
import { communicationAgent } from './domains/communication';
import { indexKnowledgeWorkflow, knowledgeQueryTool } from './domains/knowledge';

// All infrastructure is optional and driven by env vars (see shared/config/infrastructure.ts)
// Fail-fast ONLY on malformed PRESENT env values (spec 08); absence is always legal.
validateEnv();

const { storage, vectors, observability, pubsub, auth, mcpClient, services } = buildInfrastructure();

// MCP server (spec 04 §3.3): composition-layer module — the ONLY place allowed to
// import domain barrels for MCPServer assembly (ADR-007 carve-out); off unless ENABLE_MCP_SERVER=true.
const { mcpServer } = await buildMcpServer(services);

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
// Custom HTTP surface (spec 08): { cors?, middleware, apiRoutes } — Object.assign keeps
// the server literal free of local identifiers (dev-bundler extraction rule above).
const surface = buildServerSurface(services); // pushes CORS / Rate limiting / Webhook signing rows
Object.assign(serverConfig, surface);

export const mastra = new Mastra({
  // fastembed ships platform .node binaries; the bundlers (esp. worker build)
  // cannot analyze them — keep them external (resolved from node_modules at runtime)
  bundler: {
    externals: ['@anush008/tokenizers'],
  },
  // spec 07 §3.2: map KEYS are the IDs startExperiment resolves + Studio lists
  scorers: buildEvalScorers(),
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
  // proxies gate on mcpClient, NOT on mcpServer: shipped defaults (ENABLE_MCP_SERVER unset)
  // + MCP_SERVERS set must still surface external servers in Studio (spec 04 §3.3):
  ...((mcpServer || mcpClient) && {
    mcpServers: {
      ...(mcpServer && { boilerplate: mcpServer }),
      ...(mcpClient?.toMCPServerProxies() ?? {}),
    },
  }),
  server: serverConfig,
});

detectSchedules(services, mastra);
logServiceAvailability(services);
