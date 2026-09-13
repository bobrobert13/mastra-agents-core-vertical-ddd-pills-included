import { z } from 'zod';

/**
 * Pure env parser + inbound-tool approval policy for MCP (spec 04 §3.1/§3.2).
 *
 * RUNTIME-DEPENDENCY-FREE BY CONTRACT: this module must never import
 * `@mastra/mcp` or `logger` — the unit tier tests it offline without ever
 * loading the MCP SDK (shared/AGENTS.md "one reason to change" split).
 * `mcp.ts` (the builder) is the only module allowed to pair it with the SDK.
 */

/** One `MCP_SERVERS` JSON entry (validated shape). `agents` is a builder-owned
 *  routing key — `toSdkServers()` in `mcp.ts` strips it before the entry
 *  reaches `MCPClient.servers`; it is NOT a MastraMCPServerDefinition field. */
export interface McpServerJsonEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  inheritDefaultEnv?: boolean;
  url?: string;
  requestInit?: { headers?: Record<string, string> };
  allowedHosts?: string[];
  timeout?: number;
  /** Explicit override ONLY. Unset ⇒ `defaultMcpApprovalPolicy` applies (§3.2). */
  requireToolApproval?: boolean;
  /** Default false. `true` emits a log warning (tool instructions are untrusted model input). */
  forwardInstructions?: boolean;
  /** Mastra agent registry keys that receive this server's tools; default [] = wired nowhere. */
  agents?: string[];
}

export interface McpEnv {
  /** JSON: Record<serverName, McpServerJsonEntry>. Empty string counts as unset. */
  MCP_SERVERS?: string;
  /** 'true' activates the exposed server; anything else = off. */
  ENABLE_MCP_SERVER?: string;
}

/** Key reserved for this project's own exposed MCPServer in the `mcpServers` map (§3.3). */
export const RESERVED_SERVER_KEY = 'boilerplate';

const ERROR_SUFFIX = 'Unset the variable to disable MCP entirely; see .env.example.';
const EXPECTED_SHAPE =
  'Expected a JSON object of server definitions keyed by server name, ' +
  'e.g. {"wikipedia":{"command":"npx","args":["-y","wikipedia-mcp"]}}';

const jsonError = (problem: string): string =>
  `[MCP] Invalid MCP_SERVERS: ${problem}. ${EXPECTED_SHAPE}. ${ERROR_SUFFIX}`;

const entryError = (name: string, reason: string): string =>
  `[MCP] Invalid MCP_SERVERS entry "${name}": ${reason}. ${ERROR_SUFFIX}`;

/** `${VAR}` references are interpolated from process.env at build time;
 *  an unset VAR is a boot error in the same Scenario-2 message family. */
const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function interpolateString(value: string, entryName: string, where: string): string {
  return value.replace(VAR_RE, (match, varName: string) => {
    const resolved = process.env[varName];
    if (resolved === undefined) {
      throw new Error(
        entryError(
          entryName,
          `environment variable "${varName}" referenced as ${match} in ${where} is not set`
        )
      );
    }
    return resolved;
  });
}

const entrySchema = z
  .object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    inheritDefaultEnv: z.boolean().optional(),
    url: z.string().min(1).optional(),
    requestInit: z
      .object({
        headers: z.record(z.string()).optional(),
      })
      .strict()
      .optional(),
    allowedHosts: z.array(z.string()).optional(),
    timeout: z.number().int().positive().optional(),
    requireToolApproval: z.boolean().optional(),
    forwardInstructions: z.boolean().optional(),
    agents: z.array(z.string()).optional(),
  })
  .strict();

const HTTP_ONLY_KEYS = ['requestInit', 'allowedHosts'] as const;
const STDIO_ONLY_KEYS = ['env', 'inheritDefaultEnv', 'args'] as const;

function checkEntry(name: string, parsed: McpServerJsonEntry): void {
  const hasStdio = parsed.command !== undefined;
  const hasHttp = parsed.url !== undefined;
  if (hasStdio === hasHttp) {
    // both OR neither → transport ambiguity is a config bug (§3.1 DECIDED)
    throw new Error(
      entryError(name, 'exactly one of "command" (stdio) or "url" (HTTP) is required')
    );
  }
  if (hasStdio) {
    for (const key of HTTP_ONLY_KEYS) {
      if (parsed[key] !== undefined) {
        throw new Error(entryError(name, `"${key}" is only valid on "url" (HTTP) entries`));
      }
    }
  } else {
    for (const key of STDIO_ONLY_KEYS) {
      if (parsed[key] !== undefined) {
        throw new Error(entryError(name, `"${key}" is only valid on "command" (stdio) entries`));
      }
    }
    try {
      const u = new URL(parsed.url as string);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error(`unsupported protocol "${u.protocol}"`);
      }
    } catch (error) {
      const reason =
        error instanceof Error && error.message.startsWith('unsupported protocol')
          ? `invalid "url": ${error.message} (absolute http/https URL required)`
          : `invalid "url": not an absolute URL (${String(parsed.url)})`;
      throw new Error(entryError(name, reason), { cause: error });
    }
  }
}

function interpolateEntry(name: string, parsed: McpServerJsonEntry): McpServerJsonEntry {
  if (parsed.env) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.env)) {
      env[key] = interpolateString(value, name, `env.${key}`);
    }
    parsed.env = env;
  }
  if (parsed.requestInit?.headers) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.requestInit.headers)) {
      headers[key] = interpolateString(value, name, `requestInit.headers.${key}`);
    }
    parsed.requestInit = { ...parsed.requestInit, headers };
  }
  return parsed;
}

/**
 * Parse + validate `MCP_SERVERS` (spec 04 Scenario 2).
 * - `undefined`, empty/whitespace string, or `'{}'` ⇒ `{}` (unset = off, never errors).
 * - Set-but-invalid ⇒ throws with the exact `[MCP] Invalid MCP_SERVERS …` message family.
 */
export function parseMcpServers(raw: string | undefined): Record<string, McpServerJsonEntry> {
  if (raw === undefined || raw.trim() === '') return {};

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      jsonError(`JSON parse failed ("${error instanceof Error ? error.message : String(error)}")`),
      {
        cause: error,
      }
    );
  }

  if (parsedJson === null || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    throw new Error(
      jsonError(
        'expected a JSON object of server definitions, got ' +
          (Array.isArray(parsedJson) ? 'an array' : typeof parsedJson)
      )
    );
  }

  const out: Record<string, McpServerJsonEntry> = {};
  for (const [name, value] of Object.entries(parsedJson as Record<string, unknown>)) {
    if (name === RESERVED_SERVER_KEY) {
      throw new Error(
        entryError(
          name,
          `"${RESERVED_SERVER_KEY}" is reserved for this project's own exposed MCPServer key`
        )
      );
    }
    const result = entrySchema.safeParse(value);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path =
        issue.path.length > 0 ? `"${issue.path.join('.')}": ${issue.message}` : issue.message;
      throw new Error(entryError(name, path));
    }
    const entry = result.data as McpServerJsonEntry;
    checkEntry(name, entry);
    out[name] = interpolateEntry(name, entry);
  }
  return out;
}

/** Banner/log warnings derived from parsed entries (spec 04 §3.2/§3.4/§3.6). Pure. */
export interface McpWarning {
  server: string;
  /** 'banner' ⇒ appended to the MCP-client ServiceStatus detail; 'log' ⇒ logger.warn only. */
  severity: 'banner' | 'log';
  message: string;
}

export function mcpWarnings(entries: Record<string, McpServerJsonEntry>): McpWarning[] {
  const warnings: McpWarning[] = [];
  for (const [name, entry] of Object.entries(entries)) {
    const stdio = entry.command !== undefined;
    if (stdio && entry.inheritDefaultEnv !== false) {
      warnings.push({
        server: name,
        severity: 'banner',
        message: `${name}: no inheritDefaultEnv:false — stdio env not isolated`,
      });
    }
    if (entry.requireToolApproval === false) {
      warnings.push({
        server: name,
        severity: 'banner',
        message: `${name}: approval OFF — every tool runs unattended`,
      });
    }
    if (entry.url && entry.requestInit?.headers) {
      warnings.push({
        server: name,
        severity: 'log',
        message:
          `${name}: url + requestInit.headers — if Streamable-HTTP falls back to legacy SSE, custom headers are NOT attached ` +
          `(SSE needs eventSourceInit, not JSON-expressible). Configure allowedHosts + "requireToolApproval": true for such remote servers.`,
      });
    }
    if (entry.forwardInstructions === true) {
      warnings.push({
        server: name,
        severity: 'log',
        message: `${name}: forwardInstructions:true sends server instructions into the agent system prompt — untrusted model input`,
      });
    }
  }
  return warnings;
}

/* ------------------------------------------------------------------ *
 * Approval policy (inbound — MCPClient side), spec 04 §3.2.
 * ------------------------------------------------------------------ */

// Settled roots write|edit|delete (D4) extended with this repo's mutating verbs
// remove|drop|create|update. Delimiter-boundary only — see toSnake() for humps.
const MUTATING_NAME = /(?:^|[_\-.])(?:write|edit|delete|remove|drop|create|update)(?:[_\-.]|$)/i;

/** Normalize camelCase/PascalCase humps to delimiters so `deleteFile`,
 *  `createIssue`, `removeItem`, `updateRecord` are caught like snake_case. */
const toSnake = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2');

/**
 * Default server-level `requireToolApproval` predicate. Name heuristics are a
 * FLOOR, not a ceiling: semantically-mutating tools dodging the verb list
 * (`purge_all`, `wipe_bucket`) pass ungated — untrusted servers must set
 * `"requireToolApproval": true` wholesale (spec 04 R2).
 */
export function defaultMcpApprovalPolicy({ toolName }: { toolName: string }): boolean {
  return MUTATING_NAME.test(toSnake(toolName));
}
