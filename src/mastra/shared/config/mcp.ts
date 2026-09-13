import { MCPClient } from '@mastra/mcp';
import type { MastraMCPServerDefinition } from '@mastra/mcp';
import type { Tool } from '@mastra/core/tools';

import { logger } from '../logger';
import type { ServiceRegistry } from './service-status';
import {
  defaultMcpApprovalPolicy,
  mcpWarnings,
  parseMcpServers,
  type McpServerJsonEntry,
} from './mcp-parse';

/**
 * MCP client builder (spec 04 §3.3). Owns EXACTLY ONE module-level memoized
 * MCPClient singleton — no other module may construct an MCPClient.
 *
 * ESM-ordering trap this guards against: a domain module's top-level await
 * (`loadMcpToolsFor` in `research/agent.ts`) evaluates BEFORE `index.ts` runs
 * `buildInfrastructure()`. If each entry point constructed its own client, a
 * configured stdio server would spawn twice — and the explicit `id` below
 * would mask it (the duplicate-config throw only exists without an id).
 * So: `getMcpClient()` memoizes at module scope; `buildMcpClient()` only
 * re-gets the memoized instance to report banner status.
 */

const CLIENT_ID = 'boilerplate-mcp-client';
const PER_SERVER_TIMEOUT_MS = 3_000;

/** undefined = not built yet; null = built, nothing configured (off). */
let clientSingleton: MCPClient | null | undefined;
let parsedEntries: Record<string, McpServerJsonEntry> = {};
const toolsMemo = new Map<string, Promise<Record<string, Tool>>>();

/** Convert a validated JSON entry into the SDK server definition,
 *  STRIPPING the builder-owned `agents` routing key (§3.1). */
function toSdkServer(entry: McpServerJsonEntry): MastraMCPServerDefinition {
  const def: Record<string, unknown> = { ...entry };
  delete def.agents; // builder-owned routing key must never leak into the SDK (§3.1)
  if (entry.url) def.url = new URL(entry.url);
  // explicit boolean wins; unset ⇒ name-heuristic policy (§3.2)
  if (entry.requireToolApproval === undefined) {
    def.requireToolApproval = defaultMcpApprovalPolicy;
  }
  return def as unknown as MastraMCPServerDefinition;
}

/**
 * Lazy parse + construct, memoized. Malformed config THROWS (fail-fast,
 * Scenario 2). Returns undefined when nothing is configured (unset = off).
 */
export function getMcpClient(): MCPClient | undefined {
  if (clientSingleton === null) return undefined;
  if (clientSingleton) return clientSingleton;

  const entries = parseMcpServers(process.env.MCP_SERVERS);
  if (Object.keys(entries).length === 0) {
    clientSingleton = null;
    return undefined;
  }
  parsedEntries = entries;
  for (const warning of mcpWarnings(entries)) {
    if (warning.severity === 'log') logger.warn(`[MCP] ${warning.message}`);
  }
  const servers: Record<string, MastraMCPServerDefinition> = {};
  for (const [name, entry] of Object.entries(entries)) {
    servers[name] = toSdkServer(entry);
  }
  clientSingleton = new MCPClient({ id: CLIENT_ID, servers });
  return clientSingleton;
}

function transportLabel(entry: McpServerJsonEntry): string {
  return entry.command !== undefined ? 'stdio' : (entry.url as string);
}

/**
 * Create-or-get the singleton and push "MCP client" status in BOTH branches.
 * Returns `{}` (no `client` key) when nothing is configured.
 */
export function buildMcpClient(services: ServiceRegistry): { client?: MCPClient } {
  let client: MCPClient | undefined;
  try {
    client = getMcpClient();
  } catch (error) {
    // fail-fast with the Scenario-2 message; rethrow after the banner line so
    // the actionable text is the last thing printed before boot dies
    services.push({ name: 'MCP client', active: false, detail: `✗ ${(error as Error).message}` });
    throw error;
  }

  if (!client) {
    services.push({
      name: 'MCP client',
      active: false,
      detail: 'off — set MCP_SERVERS to connect external servers (see .env.example)',
    });
    return {};
  }

  const names = Object.keys(parsedEntries);
  const countLabel = names.length === 1 ? '1 server: ' : `${names.length} servers: `;
  let detail =
    countLabel + names.map(name => `${name} (${transportLabel(parsedEntries[name])})`).join(', ');
  const bannerWarnings = mcpWarnings(parsedEntries).filter(w => w.severity === 'banner');
  if (bannerWarnings.length > 0) {
    // continuation lines align under the detail column of logServiceAvailability
    detail += bannerWarnings.map(w => `\n                   [warn] ${w.message}`).join('');
  }
  services.push({ name: 'MCP client', active: true, detail });
  return { client };
}

/** Longest configured server-name prefix owning a `serverName_toolName` key. */
function ownerServer(toolKey: string): string | undefined {
  let owner: string | undefined;
  for (const server of Object.keys(parsedEntries)) {
    if (toolKey.startsWith(`${server}_`) && (!owner || server.length > owner.length)) {
      owner = server;
    }
  }
  return owner;
}

/**
 * Tools of every configured server whose `agents` routing key includes
 * `agentKey`. Degrades to `{}` + warn lines — a down server NEVER crashes
 * boot (reliability, §5); malformed config still hard-fails upstream.
 * Memoized per agentKey so repeated dynamic tool resolution does not re-list.
 */
export function loadMcpToolsFor(agentKey: string): Promise<Record<string, Tool>> {
  const cached = toolsMemo.get(agentKey);
  if (cached) return cached;
  const promise = doLoadMcpToolsFor(agentKey).catch(error => {
    toolsMemo.delete(agentKey); // never memoize a rejection
    logger.warn(`[MCP] tool discovery failed for agent "${agentKey}": ${(error as Error)?.message ?? error}`);
    return {};
  });
  toolsMemo.set(agentKey, promise);
  return promise;
}

async function doLoadMcpToolsFor(agentKey: string): Promise<Record<string, Tool>> {
  const client = getMcpClient();
  if (!client) return {};

  const targets = Object.entries(parsedEntries)
    .filter(([, entry]) => entry.agents?.includes(agentKey))
    .map(([name]) => name);
  if (targets.length === 0) return {}; // zero-config / unrouted ⇒ no connect, no spawn

  const { tools, errors, durations } = await client.listToolsWithErrors({
    perServerTimeoutMs: PER_SERVER_TIMEOUT_MS,
  });
  for (const [server, message] of Object.entries(errors ?? {})) {
    logger.warn(
      `[MCP] server "${server}" unavailable (${durations?.[server] ?? '?'}ms) — tools excluded, boot continues: ${message}`,
    );
  }

  const out: Record<string, Tool> = {};
  for (const [toolKey, tool] of Object.entries(tools ?? {})) {
    const owner = ownerServer(toolKey);
    if (owner && targets.includes(owner)) out[toolKey] = tool as Tool;
  }
  return out;
}
