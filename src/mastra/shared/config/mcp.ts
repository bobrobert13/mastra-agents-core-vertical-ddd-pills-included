// Mastra MCP client: https://mastra.ai/docs/mcp/overview
import { MCPClient } from '@mastra/mcp';
import type { MastraMCPServerDefinition } from '@mastra/mcp';
import type { Tool } from '@mastra/core/tools';
import { z } from 'zod';
import { logger } from '../logger';

const entrySchema = z
  .object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    inheritDefaultEnv: z.boolean().optional(),
    url: z.string().min(1).optional(),
    requestInit: z.object({ headers: z.record(z.string()).optional() }).strict().optional(),
    allowedHosts: z.array(z.string()).optional(),
    timeout: z.number().int().positive().optional(),
    requireToolApproval: z.boolean().optional(),
    forwardInstructions: z.boolean().optional(),
    agents: z.array(z.string()).optional(),
  })
  .strict();

export type McpServerEntry = z.infer<typeof entrySchema>;

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function interpolate(value: string, where: string): string {
  return value.replace(VAR_RE, (match, name: string) => {
    const resolved = process.env[name];
    if (resolved === undefined) {
      throw new Error(`[MCP] Invalid MCP_SERVERS: ${where} references unset ${match}`);
    }
    return resolved;
  });
}

export function parseMcpServers(raw: string | undefined): Record<string, McpServerEntry> {
  if (raw === undefined || raw.trim() === '') return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`[MCP] Invalid MCP_SERVERS: JSON parse failed (${String(error)})`, {
      cause: error,
    });
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('[MCP] Invalid MCP_SERVERS: expected a JSON object keyed by server name');
  }

  const out: Record<string, McpServerEntry> = {};
  for (const [name, value] of Object.entries(json as Record<string, unknown>)) {
    const parsed = entrySchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`[MCP] Invalid MCP_SERVERS entry "${name}": ${parsed.error.issues[0].message}`);
    }
    const entry = parsed.data;
    const hasCommand = entry.command !== undefined;
    const hasUrl = entry.url !== undefined;
    if (hasCommand === hasUrl) {
      throw new Error(`[MCP] Invalid MCP_SERVERS entry "${name}": exactly one of command or url is required`);
    }
    if (hasCommand && (entry.requestInit || entry.allowedHosts)) {
      throw new Error(`[MCP] Invalid MCP_SERVERS entry "${name}": requestInit/allowedHosts are HTTP-only`);
    }
    if (hasUrl && (entry.env || entry.inheritDefaultEnv !== undefined || entry.args)) {
      throw new Error(`[MCP] Invalid MCP_SERVERS entry "${name}": env/args are stdio-only`);
    }
    if (entry.env) {
      entry.env = Object.fromEntries(
        Object.entries(entry.env).map(([key, val]) => [key, interpolate(val, `${name}.env.${key}`)])
      );
    }
    if (entry.requestInit?.headers) {
      entry.requestInit.headers = Object.fromEntries(
        Object.entries(entry.requestInit.headers).map(([key, val]) => [
          key,
          interpolate(val, `${name}.requestInit.headers.${key}`),
        ])
      );
    }
    out[name] = entry;
  }
  return out;
}

let client: MCPClient | null | undefined;
let entries: Record<string, McpServerEntry> = {};
const toolsMemo = new Map<string, Promise<Record<string, Tool>>>();

function toServer(entry: McpServerEntry): MastraMCPServerDefinition {
  const def: Record<string, unknown> = { ...entry };
  delete def.agents;
  if (entry.url) def.url = new URL(entry.url);
  def.requireToolApproval = entry.requireToolApproval ?? true;
  def.forwardInstructions = entry.forwardInstructions ?? false;
  return def as unknown as MastraMCPServerDefinition;
}

export function buildMcpClient(): MCPClient | undefined {
  if (client !== undefined) return client ?? undefined;
  entries = parseMcpServers(process.env.MCP_SERVERS);
  if (Object.keys(entries).length === 0) {
    client = null;
    return undefined;
  }
  const servers = Object.fromEntries(
    Object.entries(entries).map(([name, entry]) => [name, toServer(entry)])
  );
  client = new MCPClient({ id: 'boilerplate-mcp-client', servers });
  logger.info(`[MCP] client: ${Object.keys(entries).join(', ')}`);
  return client;
}

function ownerServer(toolKey: string): string | undefined {
  let owner: string | undefined;
  for (const server of Object.keys(entries)) {
    if (toolKey.startsWith(`${server}_`) && (!owner || server.length > owner.length)) owner = server;
  }
  return owner;
}

export function loadMcpToolsFor(agentKey: string): Promise<Record<string, Tool>> {
  const cached = toolsMemo.get(agentKey);
  if (cached) return cached;
  const promise = (async () => {
    const mcp = buildMcpClient();
    if (!mcp) return {};
    const targets = Object.entries(entries)
      .filter(([, entry]) => entry.agents?.includes(agentKey))
      .map(([name]) => name);
    if (targets.length === 0) return {};
    const { tools, errors } = await mcp.listToolsWithErrors({ perServerTimeoutMs: 3_000 });
    for (const [server, message] of Object.entries(errors ?? {})) {
      logger.warn(`[MCP] server "${server}" unavailable — tools excluded: ${message}`);
    }
    return Object.fromEntries(
      Object.entries(tools ?? {}).filter(([key]) => {
        const owner = ownerServer(key);
        return owner !== undefined && targets.includes(owner);
      })
    );
  })().catch(error => {
    toolsMemo.delete(agentKey);
    logger.warn(`[MCP] tool discovery failed for "${agentKey}": ${String(error)}`);
    return {};
  });
  toolsMemo.set(agentKey, promise);
  return promise;
}
