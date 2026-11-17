// Mastra MCP server: https://mastra.ai/docs/mcp/overview
import { MCPServer } from '@mastra/mcp';
import { researchAgent } from '../domains/research';

export function createReadonlyMcpServer(): MCPServer {
  return new MCPServer({
    name: 'mastra-boilerplate',
    version: '1.0.0',
    description: 'Read-only research agent surface.',
    tools: {},
    agents: { research: researchAgent },
  });
}

export function buildMcpServer(): { mcpServer?: MCPServer } {
  return process.env.ENABLE_MCP_SERVER === 'true'
    ? { mcpServer: createReadonlyMcpServer() }
    : {};
}
