/**
 * Provider-agnostic model resolution.
 *
 * The boilerplate ships NO baked-in provider preference: the actual model
 * comes from env vars, so the same code runs on DeepInfra, OpenAI, Anthropic,
 * Google, xAI, Ollama or any Mastra-supported gateway — and per-agent overrides
 * are supported for cost/latency tuning.
 *
 * Precedence (per agent):  MODEL_<AGENT>  >  MODEL  >  DEFAULT_MODEL
 * Memory summarizer:       OBSERVATIONAL_MEMORY_MODEL  >  MODEL  >  DEFAULT_MODEL
 *
 * Model ids use Mastra's "provider/model-id" format, e.g.
 *   deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731
 *   openai/gpt-4o-mini
 *   anthropic/claude-sonnet-4-5
 *   ollama/llama3.1
 */

export type ModelKey =
  'research' | 'tasks' | 'files' | 'comms' | 'observational-memory' | 'scope-guard';

/** Last-resort default so the app constructs agents without any env config. */
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

/** Resolve the model id for one agent key, following the precedence chain. */
export function resolveModel(key: ModelKey): string {
  if (key === 'observational-memory') {
    return env('OBSERVATIONAL_MEMORY_MODEL') ?? env('MODEL') ?? DEFAULT_MODEL;
  }

  const perAgent = env(`MODEL_${key.toUpperCase()}`);
  if (perAgent) return perAgent;

  return env('MODEL') ?? DEFAULT_MODEL;
}

/** Ready-to-use model string for a domain agent. */
export const agentModel = {
  research: () => resolveModel('research'),
  tasks: () => resolveModel('tasks'),
  files: () => resolveModel('files'),
  comms: () => resolveModel('comms'),
};

/** Model for Memory's observational/summarizer workloads. */
export const memoryModel = () => resolveModel('observational-memory');

/** Model for the scope-guard classifier (keep cheap: one extra call per turn). */
export const guardModel = (): string => env('SCOPE_GUARD_MODEL') ?? env('MODEL') ?? DEFAULT_MODEL;
