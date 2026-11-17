import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const HELPER = path.resolve(process.cwd(), 'tests/integration/helpers/echo-mcp-server.mjs');

process.env.MCP_SERVERS = JSON.stringify({
  echo: {
    command: process.execPath,
    args: [HELPER],
    inheritDefaultEnv: false,
    agents: ['research'],
  },
});

describe('MCP stdio integration', () => {
  it('discovers the echo tools for the research agent only', async () => {
    vi.resetModules();
    const mcp = await import('../../src/mastra/shared/config/mcp');

    const tools = await mcp.loadMcpToolsFor('research');
    expect(Object.keys(tools).sort()).toEqual(['echo_delete_file', 'echo_ping']);

    expect(await mcp.loadMcpToolsFor('tasks')).toEqual({});
  }, 30_000);

  afterAll(async () => {
    const mcp = await import('../../src/mastra/shared/config/mcp');
    await mcp.buildMcpClient()?.disconnect();
    delete process.env.MCP_SERVERS;
  });
});
