import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ServiceRegistry } from '../../../../src/mastra/shared/config/service-status';

/**
 * Singleton / instance-identity tests for the §3.3 ESM-ordering trap
 * (spec 04 DoD). This file IS permitted to load `@mastra/mcp` — guarded by
 * skipIf like the integration tier, so the unit tier stays green without the
 * install. It never spawns a subprocess: no configured server is routed to a
 * key we list here (routed-spawn coverage lives in mcp-stdio.test.ts).
 */
let hasMcp = true;
try {
  await import('@mastra/mcp');
} catch {
  hasMcp = false;
}

type McpModule = typeof import('../../../../src/mastra/shared/config/mcp');

const load = async (): Promise<McpModule> => {
  vi.resetModules();
  return import('../../../../src/mastra/shared/config/mcp');
};

const saved = process.env.MCP_SERVERS;

afterEach(() => {
  if (saved === undefined) delete process.env.MCP_SERVERS;
  else process.env.MCP_SERVERS = saved;
});

describe.skipIf(!hasMcp)('MCP client builder — singleton (spec 04 §3.3/§3.9)', () => {
  it('unset MCP_SERVERS: no client, off banner, loadMcpToolsFor resolves {}', async () => {
    delete process.env.MCP_SERVERS;
    const mcp = await load();
    const services: ServiceRegistry = [];

    expect(mcp.buildMcpClient(services)).toEqual({});
    expect(mcp.getMcpClient()).toBeUndefined();
    expect(await mcp.loadMcpToolsFor('research')).toEqual({});
    expect(services).toContainEqual({
      name: 'MCP client',
      active: false,
      detail: 'off — set MCP_SERVERS to connect external servers (see .env.example)',
    });
  });

  it('one client shared by buildMcpClient and getMcpClient; one status per call', async () => {
    // unrouted (agents: []) ⇒ nothing connects ⇒ no subprocess in the unit tier
    process.env.MCP_SERVERS =
      '{"wikipedia":{"command":"node","args":["-e","setInterval(()=>{},60000)"],"inheritDefaultEnv":false,"agents":[]}}';
    const mcp = await load();
    const first: ServiceRegistry = [];
    const second: ServiceRegistry = [];

    const { client } = mcp.buildMcpClient(first);
    expect(client).toBeDefined();
    expect(mcp.getMcpClient()).toBe(client); // same memoized instance
    const again = mcp.buildMcpClient(second);
    expect(again.client).toBe(client); // re-get, never re-construct

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: 'MCP client', active: true });
    expect(first[0].detail).toContain('1 server: wikipedia (stdio)');
    expect(second[0].detail).toBe(first[0].detail);
  });

  it('multi-server detail + banner warnings follow the §3.6 canonical strings', async () => {
    process.env.MCP_SERVERS =
      '{"wikipedia":{"command":"npx","args":["-y","wikipedia-mcp"],"agents":["research"]},' +
      '"weather":{"url":"https://weather.example.com/mcp","requireToolApproval":false}}';
    const mcp = await load();
    const services: ServiceRegistry = [];
    mcp.buildMcpClient(services);

    const line = services.find(s => s.name === 'MCP client');
    expect(line?.active).toBe(true);
    expect(line?.detail).toContain(
      '2 servers: wikipedia (stdio), weather (https://weather.example.com/mcp)'
    );
    expect(line?.detail).toContain(
      '[warn] wikipedia: no inheritDefaultEnv:false — stdio env not isolated'
    );
    expect(line?.detail).toContain('[warn] weather: approval OFF — every tool runs unattended');
  });

  it('unrouted agents never trigger discovery: loadMcpToolsFor("tasks") → {}', async () => {
    process.env.MCP_SERVERS =
      '{"wikipedia":{"command":"node","args":["-e","setInterval(()=>{},60000)"],"inheritDefaultEnv":false,"agents":["research"]}}';
    const mcp = await load();
    expect(await mcp.loadMcpToolsFor('tasks')).toEqual({});
  });

  it('set-but-invalid MCP_SERVERS fails fast with the Scenario-2 message', async () => {
    process.env.MCP_SERVERS = '{wikipedia';
    const mcp = await load();
    const services: ServiceRegistry = [];
    expect(() => mcp.buildMcpClient(services)).toThrow(
      '[MCP] Invalid MCP_SERVERS: JSON parse failed'
    );
  });
});
