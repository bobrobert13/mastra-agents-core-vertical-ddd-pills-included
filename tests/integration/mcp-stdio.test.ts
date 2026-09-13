import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { ServiceStatus } from '../../src/mastra/shared/config/service-status';

/**
 * Spec 04 §3.9 integration tier: real stdio subprocess through the single
 * memoized MCPClient — namespaced discovery, approval predicate wiring,
 * singleton/instance identity (ONE child process after BOTH buildMcpClient
 * and loadMcpToolsFor ran), and clean disconnect.
 *
 * No npx, no network: the echo server is spawned with process.execPath.
 * Skipped (not failed) when @mastra/mcp is not installed — same top-level
 * pattern as tests/integration/scope-guard-live.test.ts. The echo helper
 * (tests/integration/helpers/echo-mcp-server.mjs) is a REQUIRED artifact
 * (see .artifacts/integration-brief-04.md): with the SDK installed but the
 * helper missing, this suite fails loudly instead of hiding the gap.
 */
let hasMcp = true;
try {
  await import('@mastra/mcp');
} catch {
  hasMcp = false;
}

const HELPER = path.resolve(process.cwd(), 'tests/integration/helpers/echo-mcp-server.mjs');
const PID_FILE = path.resolve(process.cwd(), '.mastra', `mcp-echo-pid-${process.pid}.txt`);

const mcp = hasMcp ? await import('../../src/mastra/shared/config/mcp') : ({} as never);

// Must be set BEFORE any getMcpClient() call — the singleton parses lazily once.
process.env.MCP_SERVERS = JSON.stringify({
  echo: {
    command: process.execPath,
    args: [HELPER],
    inheritDefaultEnv: false,
    env: { MCP_PID_FILE: PID_FILE },
    agents: ['research'],
  },
});

const spawnLines = (): string[] =>
  existsSync(PID_FILE) ? readFileSync(PID_FILE, 'utf8').split('\n').filter(Boolean) : [];

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(!hasMcp)('MCP stdio integration (spec 04)', () => {
  it('requires the echo helper artifact when @mastra/mcp is installed', () => {
    expect(existsSync(HELPER), `missing ${HELPER} — create it per .artifacts/integration-brief-04.md`).toBe(true);
  });

  it('buildMcpClient: returns the singleton + active banner line, spawns nothing yet', () => {
    const services: ServiceStatus[] = [];
    const { client } = mcp.buildMcpClient(services);
    expect(client).toBeDefined();
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe('MCP client');
    expect(services[0].active).toBe(true);
    expect(services[0].detail).toContain('1 server: echo (stdio)');
    expect(services[0].detail).not.toContain('[warn]'); // inheritDefaultEnv:false + policy on
    expect(spawnLines()).toEqual([]); // construction is connection-free
  });

  it('loadMcpToolsFor("research"): namespaced tools + exactly ONE stdio subprocess', async () => {
    const tools = await mcp.loadMcpToolsFor('research');
    expect(Object.keys(tools).sort()).toEqual(['echo_delete_file', 'echo_ping']);

    // the §3.3 ESM-ordering trap closure: after BOTH entry points ran,
    // exactly one child was spawned and the instance identity holds
    expect(mcp.getMcpClient()).toBe(mcp.buildMcpClient([]).client);
    expect(spawnLines()).toHaveLength(1);

    // approval wiring (Scenario 3): server-level predicate is a function ⇒
    // tools carry needsApprovalFn; mutating name gates, read-only name does not
    const deleteTool = tools.echo_delete_file as unknown as {
      needsApprovalFn?: (args: Record<string, unknown>, ctx?: object) => Promise<boolean> | boolean;
    };
    const pingTool = tools.echo_ping as unknown as {
      needsApprovalFn?: (args: Record<string, unknown>, ctx?: object) => Promise<boolean> | boolean;
    };
    expect(await deleteTool.needsApprovalFn?.({}, {})).toBe(true);
    expect(await pingTool.needsApprovalFn?.({}, {})).toBe(false);
  });

  it('tools are memoized per agent (no re-list, no second spawn)', async () => {
    const a = await mcp.loadMcpToolsFor('research');
    const b = await mcp.loadMcpToolsFor('research');
    expect(b).toBe(a);
    expect(spawnLines()).toHaveLength(1);
    // unrouted agent key never triggers discovery
    expect(await mcp.loadMcpToolsFor('tasks')).toEqual({});
  });

  it('disconnect() closes the subprocess', async () => {
    const [pid] = spawnLines().map(Number);
    expect(pid).toBeGreaterThan(0);
    expect(alive(pid)).toBe(true);
    await mcp.getMcpClient()?.disconnect();
    const deadline = Date.now() + 5_000;
    while (alive(pid) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(alive(pid)).toBe(false);
    rmSync(PID_FILE, { force: true });
  });
});
