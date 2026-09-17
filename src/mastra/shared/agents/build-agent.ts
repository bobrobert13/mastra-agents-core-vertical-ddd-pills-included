import { Agent, type AgentConfig, type ToolsInput } from '@mastra/core/agent';
import { agentModel, DEFAULT_MODEL } from '../config/model';
import { buildDomainMemory } from '../config/vectors';
import { createScopeGuard, type DomainScope } from '../processors/scope-guard';
import { buildSecurityStack } from '../processors/security-stack';
import { agentScorersFor } from '../evals';
import { scopedInstructions } from './scoped-instructions';
import {
  memoryOptionsFor,
  resolveConnectorTools,
  type AgentConnectors,
  type MemoryTier,
} from './connectors';

/**
 * Options for building a domain agent with security stack and memory defaults.
 * Reduces boilerplate across domain agents while preserving full flexibility.
 */
export interface BuildAgentOptions {
  /** Domain scope definition (domain name, description, boundaries) */
  scope: DomainScope;
  /** Agent-specific instruction body (appended to scoped instructions) */
  instructionsBody: string;
  /** Model key — defaults to domain name (e.g., 'research' → agentModel.research()) */
  modelKey?: string;
  /**
   * Agent tools — static map or async function receiving { mastra }.
   * When `connectors` are present (or `tools` is a function), the resolved
   * connector tools are merged in FIRST and the LOCAL tools WIN on key
   * collisions (local overrides connector).
   */
  tools?: AgentConfig['tools'];
  /**
   * Declarative connectors (`rag` / `memory` / `mcp`). Each field is
   * independent and optional; `memory` defaults to 'basic'. RAG is opt-in.
   */
  connectors?: AgentConnectors;
  /** Override maxSteps — defaults to 30 */
  maxSteps?: number;
  /** Disable response cache — REQUIRED for mutating agents (spec 06 R2) */
  disableResponseCache?: boolean;
  /** Additional Agent config overrides */
  overrides?: Partial<
    Omit<
      AgentConfig,
      | 'id'
      | 'name'
      | 'instructions'
      | 'model'
      | 'inputProcessors'
      | 'outputProcessors'
      | 'memory'
      | 'tools'
    >
  >;
}

/**
 * The per-domain knobs a domain declares in its own `config.ts`. Picking them
 * from `BuildAgentOptions` keeps the domain settings object type-checked
 * against the builder (a typo in `rag`/`memory` fails the build).
 */
export type DomainAgentSettings = Pick<
  BuildAgentOptions,
  'modelKey' | 'maxSteps' | 'connectors' | 'disableResponseCache'
>;

/**
 * Builds a domain agent with security stack, memory, and scorers wired by default.
 *
 * Handles the Spec 06 hard rule (processor arrays from buildSecurityStack),
 * auto-generates agent ID from domain name, and provides sensible defaults.
 *
 * @example
 * ```typescript
 * export const researchAgent = buildDomainAgent({
 *   scope: researchScope,
 *   instructionsBody: `You are a research specialist...`,
 *   modelKey: 'research',
 *   connectors: { memory: 'observational', rag: true }, // RAG is opt-in
 *   tools: { web_search: webSearchTool },
 * });
 * ```
 */
export function buildDomainAgent(options: BuildAgentOptions): Agent {
  const {
    scope,
    instructionsBody,
    modelKey = scope.domain,
    tools,
    connectors,
    maxSteps = 30,
    disableResponseCache = false,
    overrides = {},
  } = options;

  createScopeGuard(scope); // ensures scope validity at construction time
  const securityStack = buildSecurityStack({ scope, disableResponseCache });
  const agentId = `${scope.domain}-agent`;

  // Memory tier comes from the connector alone: 'basic' when nothing is asked.
  const tier: MemoryTier = connectors?.memory ?? 'basic';
  const memory = buildDomainMemory(memoryOptionsFor(tier));

  // Merge connector tools with local tools. Local tools WIN on key collisions.
  // No connectors + static/undefined tools ⇒ pass `tools` through untouched
  // (zero behavior change for domains that have not migrated yet).
  const mergedTools: AgentConfig['tools'] =
    connectors?.rag || connectors?.mcp || typeof tools === 'function'
      ? async ctx => {
          const connectorTools = await resolveConnectorTools(connectors, ctx);
          const localTools = typeof tools === 'function' ? await tools(ctx) : (tools ?? {});
          return { ...connectorTools, ...localTools } as ToolsInput;
        }
      : tools;

  // Resolve model: agentModel[modelKey]() with fallback to DEFAULT_MODEL
  const modelFn = (agentModel as unknown as Record<string, () => string>)[modelKey];
  const model = modelFn ? modelFn() : DEFAULT_MODEL;

  return new Agent({
    id: agentId,
    name: scope.agentName,
    description:
      overrides.description ?? `${scope.agentName} for ${scope.scope}`,
    instructions: scopedInstructions(scope, instructionsBody),
    model,
    defaultOptions: {
      maxSteps,
      autoResumeSuspendedTools: true,
    },
    inputProcessors: securityStack.inputProcessors,
    outputProcessors: securityStack.outputProcessors,
    scorers: agentScorersFor(agentId),
    memory,
    tools: mergedTools,
    ...overrides,
  });
}

/** Re-export for convenience — domain files only import from this module */
export { createScopeGuard, type DomainScope } from '../processors/scope-guard';
