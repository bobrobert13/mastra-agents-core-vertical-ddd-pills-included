import { Mastra } from '@mastra/core/mastra';
import { indexKnowledgeWorkflow, knowledgeQueryTool } from './domains/knowledge';
import { fileOperationsAgent } from './domains/file-operations';
import { deepResearchWorkflow, researchAgent } from './domains/research';
import { dailyDigestWorkflow, taskManagementAgent } from './domains/task-management';
import { buildMcpServer } from './mcp/server';
import { buildServerSurface } from './routes';
import { buildInfrastructure } from './shared/config/infrastructure';
import { VECTOR_STORE_NAME } from './shared/config/vectors';
import { logger } from './shared/logger';

const infra = buildInfrastructure();
const { mcpServer } = buildMcpServer();
const surface = buildServerSurface();
const port = Number(process.env.MASTRA_PORT ?? 4111);

const serverConfig: Record<string, unknown> = {
  port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 4111,
  host: process.env.MASTRA_HOST || '0.0.0.0',
  apiRoutes: surface.apiRoutes,
};
if (infra.auth) serverConfig.auth = infra.auth;
if (surface.cors) serverConfig.cors = surface.cors;

export const mastra = new Mastra({
  agents: {
    research: researchAgent,
    tasks: taskManagementAgent,
    files: fileOperationsAgent,
  },
  workflows: {
    'deep-research': deepResearchWorkflow,
    'daily-digest': dailyDigestWorkflow,
    'index-knowledge': indexKnowledgeWorkflow,
  },
  ...(infra.vectors.store && { vectors: { [VECTOR_STORE_NAME]: infra.vectors.store } }),
  ...(knowledgeQueryTool && { tools: { search_knowledge: knowledgeQueryTool } }),
  storage: infra.storage,
  ...(infra.observability && { observability: infra.observability }),
  ...(infra.pubsub && { pubsub: infra.pubsub }),
  ...((mcpServer || infra.mcpClient) && {
    mcpServers: {
      ...(mcpServer && { boilerplate: mcpServer }),
      ...(infra.mcpClient?.toMCPServerProxies() ?? {}),
    },
  }),
  server: serverConfig,
});

logger.info(`Storage: ${infra.storageDetail}`);
logger.info(`Vectors: ${infra.vectors.store ? 'on' : 'off (set EMBEDDING_MODEL)'}`);
logger.info(`Auth: ${infra.auth ? 'on' : 'off'}`);
logger.info(`PubSub: ${infra.pubsub ? 'Redis Streams' : 'in-process'}`);
logger.info(`MCP: ${mcpServer ? 'server + client' : infra.mcpClient ? 'client' : 'off'}`);
