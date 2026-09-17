import { loadMcpToolsFor } from '../config/mcp';
import { memoryModel } from '../config/model';
import type { DomainMemoryOptions } from '../config/vectors';

/**
 * Declarative connectors for domain agents (spec: fase 2a).
 *
 * A domain agent is composed from three orthogonal connectors instead of
 * hand-wired tool maps:
 * - `rag`    — the knowledge tool from the ROOT Mastra registry. OPT-IN: an
 *              agent never gets RAG unless it explicitly asks (`rag: true`).
 * - `memory` — the memory tier. The chatRoute requires memory, so there is no
 *              "off": `basic` (default) or `observational`.
 * - `mcp`    — the `MCP_SERVERS` routing key (`agents: [...]`) whose tools the
 *              agent receives. No key ⇒ no discovery, no subprocess.
 *
 * `resolveConnectorTools` NEVER throws: a missing/unconfigured connector
 * degrades to `{}` (zero spawn, ~0 ms) so boot and turns stay reliable.
 */

export type MemoryTier = 'basic' | 'observational';

export interface AgentConnectors {
  /** Connect the root-registry knowledge tool (RAG). Default: false — no agent is born with RAG. */
  rag?: boolean;
  /** Memory tier. Default: 'basic'. The chatRoute requires memory: there is no "off". */
  memory?: MemoryTier;
  /** `MCP_SERVERS` routing key (`agents: [...]`) whose tools the agent receives. Default: none. */
  mcp?: string;
}

/** Key of the knowledge tool as registered in the root Mastra registry. */
export const RAG_TOOL_KEY = 'search_knowledge';

/** Structural slice of the tools-resolver context we actually read. */
export interface ConnectorContext {
  /** NON-THROWING read (listTools, never getTool — the latter throws on a missing key). */
  mastra?: { listTools?: () => Record<string, unknown> | undefined };
}

/**
 * Tools contributed by the connectors. Never throws: no connector ⇒ `{}`.
 *
 * RAG is deliberately opt-in: `rag` falsy/undefined contributes NOTHING even
 * when the root registry holds the knowledge tool — that is the core contract.
 */
export async function resolveConnectorTools(
  connectors: AgentConnectors | undefined,
  ctx: ConnectorContext
): Promise<Record<string, unknown>> {
  if (!connectors) return {};

  const tools: Record<string, unknown> = {};

  if (connectors.rag === true) {
    const registered = ctx.mastra?.listTools?.();
    // Guarded read: absent registry / absent key ⇒ silent no-op, never a throw.
    if (registered && RAG_TOOL_KEY in registered) {
      tools[RAG_TOOL_KEY] = registered[RAG_TOOL_KEY];
    }
  }

  if (connectors.mcp) {
    // No key ⇒ not called at all: without MCP_SERVERS this resolves {} with no spawn.
    Object.assign(tools, await loadMcpToolsFor(connectors.mcp));
  }

  return tools;
}

/**
 * Memory options for a tier. `observational` adds compaction + recall on top of
 * the memory model; `basic` is title generation only.
 */
export function memoryOptionsFor(tier: MemoryTier): DomainMemoryOptions {
  if (tier === 'observational') {
    return { generateTitle: true, observationalMemory: { model: memoryModel() } };
  }
  return { generateTitle: true };
}
