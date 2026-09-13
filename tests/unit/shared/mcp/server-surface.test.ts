import { afterEach, describe, expect, it } from 'vitest';

import { defaultMcpApprovalPolicy } from '../../../../src/mastra/shared/config/mcp-parse';
import type { ServiceRegistry } from '../../../../src/mastra/shared/config/service-status';

/**
 * Exposed-server surface (spec 04 Scenario 4 / §5 security). Loads
 * `@mastra/mcp` + domain barrels ⇒ guarded, like the singleton file.
 */
let hasMcp = true;
try {
  await import('@mastra/mcp');
} catch {
  hasMcp = false;
}

const {
  buildMcpServer,
  createReadonlyMcpServer,
  isMcpServerEnabled,
  EXPOSED_AGENT_KEYS,
  EXPOSED_TOOL_KEYS,
  MCP_SERVER_DISABLED_DETAIL,
  MCP_SERVER_ACTIVE_DETAIL,
} = hasMcp ? await import('../../../../src/mastra/mcp/server') : ({} as never);

const saved = process.env.ENABLE_MCP_SERVER;

afterEach(() => {
  if (saved === undefined) delete process.env.ENABLE_MCP_SERVER;
  else process.env.ENABLE_MCP_SERVER = saved;
});

describe.skipIf(!hasMcp)('MCPServer surface (spec 04 Scenario 4)', () => {
  it('canonical disabled banner detail is verbatim per §3.6', () => {
    expect(MCP_SERVER_DISABLED_DETAIL).toBe(
      'disabled — set ENABLE_MCP_SERVER=true (read-only surface; requires Spec 01 auth outside localhost)'
    );
  });

  it('unset ⇒ off; anything but "true" ⇒ off; "true" ⇒ on', async () => {
    delete process.env.ENABLE_MCP_SERVER;
    expect(isMcpServerEnabled()).toBe(false);
    process.env.ENABLE_MCP_SERVER = 'TRUE';
    expect(isMcpServerEnabled()).toBe(false); // exact 'true' only
    process.env.ENABLE_MCP_SERVER = 'false';
    expect(isMcpServerEnabled()).toBe(false);
    process.env.ENABLE_MCP_SERVER = 'true';
    expect(isMcpServerEnabled()).toBe(true);
  });

  it('buildMcpServer pushes the disabled line and returns no server by default', async () => {
    delete process.env.ENABLE_MCP_SERVER;
    const services: ServiceRegistry = [];
    const result = await buildMcpServer(services);
    expect(result.mcpServer).toBeUndefined();
    expect(services).toContainEqual({
      name: 'MCP server',
      active: false,
      detail: MCP_SERVER_DISABLED_DETAIL,
    });
  });

  it('ENABLE_MCP_SERVER=true registers the read-only server + active line', async () => {
    process.env.ENABLE_MCP_SERVER = 'true';
    const services: ServiceRegistry = [];
    const { mcpServer } = await buildMcpServer(services);
    expect(mcpServer).toBeDefined();
    expect(services).toContainEqual({
      name: 'MCP server',
      active: true,
      detail: MCP_SERVER_ACTIVE_DETAIL,
    });
    expect(MCP_SERVER_ACTIVE_DETAIL).toContain('"boilerplate" at /api/mcp/boilerplate/mcp');
    expect(MCP_SERVER_ACTIVE_DETAIL).toContain('agents: research, comms; tools: file-read');
  });

  it('exposed surface contains ZERO mutating primitives (static list, §5)', () => {
    expect(
      [...EXPOSED_AGENT_KEYS, ...EXPOSED_TOOL_KEYS].some(k =>
        defaultMcpApprovalPolicy({ toolName: k })
      )
    ).toBe(false);
    // derived ask_* tool names from the exposed agents are also non-mutating
    for (const key of EXPOSED_AGENT_KEYS) {
      expect(defaultMcpApprovalPolicy({ toolName: `ask_${key}` })).toBe(false);
    }
    expect(createReadonlyMcpServer()).toBeDefined(); // constructs offline
  });
});
