import { Agent, type AgentConfig } from '@mastra/core/agent';
import { agentModel, DEFAULT_MODEL, memoryModel } from '../config/model';
import { buildDomainMemory } from '../config/vectors';
import { createScopeGuard, type DomainScope } from '../processors/scope-guard';
import { buildSecurityStack } from '../processors/security-stack';
import { agentScorersFor } from '../evals';
import { scopedInstructions } from './scoped-instructions';

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
  /** Agent tools — static map or async function receiving { mastra } */
  tools?: AgentConfig['tools'];
  /** Override maxSteps — defaults to 30 */
  maxSteps?: number;
  /** Enable observational memory (compaction + semantic recall). Default: false */
  enableObservationalMemory?: boolean;
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
 *   enableObservationalMemory: true,
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
    maxSteps = 30,
    enableObservationalMemory = false,
    disableResponseCache = false,
    overrides = {},
  } = options;

  createScopeGuard(scope); // ensures scope validity at construction time
  const securityStack = buildSecurityStack({ scope, disableResponseCache });
  const agentId = `${scope.domain}-agent`;

  const memory = buildDomainMemory({
    generateTitle: true,
    ...(enableObservationalMemory && {
      observationalMemory: { model: memoryModel() },
    }),
  });

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
    tools,
    ...overrides,
  });
}

/** Re-export for convenience — domain files only import from this module */
export { createScopeGuard, type DomainScope } from '../processors/scope-guard';
