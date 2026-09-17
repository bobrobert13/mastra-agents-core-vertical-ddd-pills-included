import { EMBEDDING_MODELS, ModelRouterEmbeddingModel } from '@mastra/core/llm';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import type { MastraEmbeddingModel } from '@mastra/core/vector';
import { fastembed } from '@mastra/fastembed';
import { logger } from '../logger';
import {
  EMBEDDING_CONFIG_ENV,
  parseEmbeddingConfig,
  type EmbeddingConfigEntry,
} from './embedding-parse';

/**
 * Embedder resolution (spec 03 §3.2). Split out of `model.ts` so the chat model
 * ids and the embedder declaration each have ONE reason to change; `model.ts`
 * re-exports these names for the existing importers.
 *
 * Precedence:
 *   SEMANTIC_RECALL=off  >  EMBEDDING_CONFIG  >  EMBEDDING_MODEL  >  fastembed local
 */

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

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

/** EMBEDDING_MODEL env, 'provider/model' format — NEVER hard-coded (gotcha #5). */
export const embeddingModel = (): string | undefined => env('EMBEDDING_MODEL');

/** Only the router keys actually present — an absent `url` means "resolve the known provider". */
function routerFields(cfg: EmbeddingConfigEntry): Pick<
  OpenAICompatibleConfig,
  'url' | 'apiKey' | 'headers'
> {
  return {
    ...(cfg.url !== undefined ? { url: cfg.url } : {}),
    ...(cfg.apiKey !== undefined ? { apiKey: cfg.apiKey } : {}),
    ...(cfg.headers !== undefined ? { headers: cfg.headers } : {}),
  };
}

/** Turn a validated EMBEDDING_CONFIG entry into the router's OpenAI-compatible shape. */
function routerConfig(cfg: EmbeddingConfigEntry): OpenAICompatibleConfig {
  const fields = routerFields(cfg);
  return cfg.id
    ? { id: cfg.id as `${string}/${string}`, ...fields }
    : { providerId: cfg.providerId as string, modelId: cfg.modelId as string, ...fields };
}

/** Resolve the EMBEDDING_CONFIG branch; undefined = degrade to `none` (boot-knowable). */
function resolveFromEmbeddingConfig(cfg: EmbeddingConfigEntry): EmbedderResolution | undefined {
  const provider = (cfg.id ? cfg.id.split('/')[0] : (cfg.providerId as string)).toLowerCase();
  const modelName = cfg.id ?? `${cfg.providerId}/${cfg.modelId}`;

  // No inline key: fall back to the provider's env key, same degrade as the legacy path.
  const keyEnv = PROVIDER_KEY_ENV[provider];
  if (!cfg.apiKey && keyEnv && !(env(keyEnv) ?? '')) {
    logger.warn(`EMBEDDING_CONFIG=${modelName} needs ${keyEnv} — not set; semantic recall disabled`);
    return undefined;
  }

  let model: ModelRouterEmbeddingModel;
  try {
    model = new ModelRouterEmbeddingModel(routerConfig(cfg));
  } catch (error) {
    // Router refuses the config (unknown provider, bad url): boot-knowable
    // "no embedder" → degrade, never crash (D3).
    logger.warn(
      `EMBEDDING_CONFIG=${modelName} rejected by the model router (${error instanceof Error ? error.message : String(error)}); semantic recall disabled`
    );
    return undefined;
  }

  const curated = EMBEDDING_MODELS.find(
    m => m.id === modelName || `${m.provider}/${m.id}` === modelName
  );
  const dimension = cfg.dimension ?? curated?.dimensions;
  return {
    source: 'model-router',
    passage: model,
    query: model,
    dimension,
    detail: `model-router · ${modelName}${dimension ? ` · ${dimension}d` : ''} · env config`,
  };
}

/**
 * Resolve the passage/query embedder pair from env. Pure function of env
 * (apart from lazy logger.warn of the off-reason): construction of the
 * fastembed E5 models is LAZY (FlagEmbedding init on first doEmbed), so an
 * offline cold cache is a RUNTIME degrade, not a resolution failure — see
 * vectors.ts markEmbedderUnavailable().
 *
 * A malformed EMBEDDING_CONFIG THROWS here (fail-fast boot, same precedent as
 * a malformed MCP_SERVERS in buildMcpClient) — it is NOT captured on purpose:
 * present-but-broken is a config bug, absence is legal.
 */
export function resolveEmbedder(): EmbedderResolution {
  if (env('SEMANTIC_RECALL') === 'off') {
    logger.warn('SEMANTIC_RECALL=off — semantic recall and knowledge RAG disabled');
    return noneResolution();
  }

  const cfg = parseEmbeddingConfig(process.env[EMBEDDING_CONFIG_ENV]);
  if (cfg) return resolveFromEmbeddingConfig(cfg) ?? noneResolution();

  const id = embeddingModel();
  if (id) {
    if (!/^[A-Za-z0-9-]+\//.test(id)) {
      logger.warn(
        `Invalid EMBEDDING_MODEL "${id}" — expected 'provider/model'; semantic recall disabled`
      );
      return noneResolution();
    }

    const provider = id.split('/')[0].toLowerCase();
    const curated = EMBEDDING_MODELS.find(m => m.id === id || `${m.provider}/${m.id}` === id);
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
