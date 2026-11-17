#!/usr/bin/env node
// Mastra MCP stdio: https://mastra.ai/docs/mcp/overview
import { logger } from '../shared/logger';
import { createReadonlyMcpServer } from './server';

if (process.env.ENABLE_MCP_SERVER !== 'true') {
  logger.error('[MCP] stdio entry requires ENABLE_MCP_SERVER=true — refusing to start.');
  process.exit(1);
}

const mcpServer = createReadonlyMcpServer();
await mcpServer.startStdio();
