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

import { EMBEDDING_MODELS, ModelRouterEmbeddingModel } from '@mastra/core/llm';
import type { MastraEmbeddingModel } from '@mastra/core/vector';
import { fastembed } from '@mastra/fastembed';
import { logger } from '../logger';

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

// ---------------------------------------------------------------------------
// Embedder resolution (spec 03 §3.2)
// ---------------------------------------------------------------------------

export type EmbedderSource = 'model-router' | 'fastembed' | 'none';

export interface EmbedderResolution {
  source: EmbedderSource;
  /** undefined iff source === 'none' — callers must degrade, never throw */
  passage?: MastraEmbeddingModel<string>;
  /** search side; for E5 = multilingualE5LargeQuery, router models === passage */
  query?: MastraEmbeddingModel<string>;
  /** undefined for valid-shape non-curated ids: pinned from actual embed output (spec 03 §3.2) */
  dimension?: number;
  /** banner fragment, e.g. 'fastembed/multilingual-e5-large · 1024d' */
  detail: string;
}

/** Provider prefix → API-key env var (mirrors config/providers.ts). */
const PROVIDER_KEY_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
};

const OFF_DETAIL = 'off (no embedder)';
const FASTEMBED_DETAIL = 'fastembed/multilingual-e5-large · 1024d';
const FASTEMBED_DIMENSION = 1024;

const noneResolution = (): EmbedderResolution => ({ source: 'none', detail: OFF_DETAIL });

/** EMBEDDING_MODEL env, 'provider/model' format — NEVER hard-coded (gotcha #5). */
export const embeddingModel = (): string | undefined => env('EMBEDDING_MODEL');

/**
 * Resolve the passage/query embedder pair from env. Pure function of env
 * (apart from lazy logger.warn of the off-reason): construction of the
 * fastembed E5 models is LAZY (FlagEmbedding init on first doEmbed), so an
 * offline cold cache is a RUNTIME degrade, not a resolution failure — see
 * vectors.ts markEmbedderUnavailable().
 */
export function resolveEmbedder(): EmbedderResolution {
  if (env('SEMANTIC_RECALL') === 'off') {
    logger.warn('SEMANTIC_RECALL=off — semantic recall and knowledge RAG disabled');
    return noneResolution();
  }

  const id = embeddingModel();
  if (id) {
    if (!/^[A-Za-z0-9-]+\//.test(id)) {
      logger.warn(`Invalid EMBEDDING_MODEL "${id}" — expected 'provider/model'; semantic recall disabled`);
      return noneResolution();
    }

    const provider = id.split('/')[0].toLowerCase();
    const curated = EMBEDDING_MODELS.find(
      m => m.id === id || `${m.provider}/${m.id}` === id
    );
    const keyEnv = PROVIDER_KEY_ENV[provider];
    if (keyEnv && !(env(keyEnv) ?? '')) {
      logger.warn(`EMBEDDING_MODEL=${id} needs ${keyEnv} — not set; semantic recall disabled`);
      return noneResolution();
    }

    let model: ModelRouterEmbeddingModel;
    try {
      model = new ModelRouterEmbeddingModel(id);
    } catch (error) {
      // Router refuses the id at construction (e.g. unknown provider/URL):
      // boot-knowable "no embedder" → degrade, never crash (D3).
      logger.warn(
        `EMBEDDING_MODEL=${id} rejected by the model router (${error instanceof Error ? error.message : String(error)}); semantic recall disabled`
      );
      return noneResolution();
    }
    const dimension = curated?.dimensions;
    return {
      source: 'model-router',
      passage: model,
      query: model,
      dimension,
      detail: dimension ? `model-router · ${id} · ${dimension}d` : `model-router · ${id}`,
    };
  }

  return {
    source: 'fastembed',
    passage: fastembed.multilingualE5LargePassage as unknown as MastraEmbeddingModel<string>,
    query: fastembed.multilingualE5LargeQuery as unknown as MastraEmbeddingModel<string>,
    dimension: FASTEMBED_DIMENSION,
    detail: FASTEMBED_DETAIL,
  };
}
