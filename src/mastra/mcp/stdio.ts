#!/usr/bin/env node
import { logger } from '../shared/logger';
import { createReadonlyMcpServer, isMcpServerEnabled } from './server';

/**
 * Standalone stdio entry for MCP-compatible desktop clients (Claude Desktop,
 * IDEs) — spec 04 §3.7. Same read-only surface as the HTTP registration,
 * WITHOUT booting the HTTP server.
 *
 * Not runnable under plain Node (extensionless repo imports ⇒
 * ERR_MODULE_NOT_FOUND); ship the esbuild bundle instead:
 *   npm run mcp:stdio  →  .mastra/mcp-stdio.mjs  (see package.json §3.7)
 */

if (!isMcpServerEnabled()) {
  logger.error('[MCP] stdio entry requires ENABLE_MCP_SERVER=true — refusing to start.');
  process.exit(1);
}

const mcpServer = createReadonlyMcpServer();
await mcpServer.startStdio();
