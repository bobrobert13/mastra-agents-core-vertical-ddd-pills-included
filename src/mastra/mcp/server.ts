import { MCPServer } from '@mastra/mcp';

import { communicationAgent } from '../domains/communication';
import { readFileTool } from '../domains/file-operations';
import { researchAgent } from '../domains/research';
import type { ServiceRegistry } from '../shared/config/service-status';

/**
 * The project's own read-only MCP server surface (spec 04 §3.3, Scenario 4).
 *
 * COMPOSITION-LAYER CARVE-OUT: `shared/` may never import `domains/`
 * (shared/AGENTS.md), but building an MCPServer REQUIRES domain agents —
 * so this module lives beside `index.ts` at composition level, and
 * `index.ts` gains exactly one awaited call to `buildMcpServer()`.
 *
 * Off by default (`ENABLE_MCP_SERVER` unset). When on, it exposes ONLY
 * non-mutating primitives: `research` + `comms` agents (both carry a
 * non-empty `description`, required by MCPServer agent-tool conversion) and
 * `readFileTool`. The file-operations and task-management agents are
 * deliberately EXCLUDED — they wire write/edit/create/update tools.
 */

/** Canonical banner strings (spec 04 §3.6) — asserted verbatim by unit tests. */
export const MCP_SERVER_DISABLED_DETAIL =
  'disabled — set ENABLE_MCP_SERVER=true (read-only surface; requires Spec 01 auth outside localhost)';
export const MCP_SERVER_ACTIVE_DETAIL =
  '"boilerplate" at /api/mcp/boilerplate/mcp + stdio `npm run mcp:stdio` → .mastra/mcp-stdio.mjs (agents: research, comms; tools: file-read)';

/** Static exposed-primitives list (unit-asserted: zero mutating names). */
export const EXPOSED_AGENT_KEYS = ['research', 'comms'] as const;
export const EXPOSED_TOOL_KEYS = ['file-read'] as const;

export function isMcpServerEnabled(): boolean {
  return process.env.ENABLE_MCP_SERVER === 'true';
}

/** Build the read-only MCPServer. Used by both the HTTP registration
 *  (`buildMcpServer` below) and the standalone stdio entry (`stdio.ts`). */
export function createReadonlyMcpServer(): MCPServer {
  return new MCPServer({
    name: 'mastra-boilerplate',
    version: '1.0.0',
    description:
      'Read-only integration surface of the mastra-boilerplate. Exposes the research and communication agents as ask_* tools and the file-read tool. Mutating primitives (file write/edit, task create/update) are deliberately NOT exposed.',
    agents: {
      research: researchAgent,
      comms: communicationAgent,
    },
    tools: {
      'file-read': readFileTool,
    },
  });
}

/**
 * Gate the local MCPServer on `ENABLE_MCP_SERVER=true`; pushes the
 * canonical "MCP server" banner line in BOTH branches. Returns
 * `{ mcpServer: undefined }` by default so `index.ts` can spread-gate.
 */
export async function buildMcpServer(
  services?: ServiceRegistry
): Promise<{ mcpServer?: MCPServer }> {
  if (!isMcpServerEnabled()) {
    services?.push({ name: 'MCP server', active: false, detail: MCP_SERVER_DISABLED_DETAIL });
    return {};
  }
  const mcpServer = createReadonlyMcpServer();
  services?.push({ name: 'MCP server', active: true, detail: MCP_SERVER_ACTIVE_DETAIL });
  return { mcpServer };
}
