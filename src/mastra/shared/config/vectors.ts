import { PgVector } from '@mastra/pg';
import { LibSQLVector } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import type { Mastra } from '@mastra/core/mastra';
import type { RequestContext } from '@mastra/core/request-context';
import type { MastraEmbeddingModel } from '@mastra/core/vector';
import type { SemanticRecall } from '@mastra/core/memory';
import { logger } from '../logger';
import { FASTEMBED_MODEL_FILE, fastembedCacheReady } from './fastembed-cache';
import { resolveEmbedder, type EmbedderResolution } from './embedder';
import type { ServiceRegistry } from './service-status';

/**
 * Vector-store selection + semantic-recall wiring (spec 03 §3.3).
 * Mirrors config/storage.ts: DATABASE_URL (postgres prefix) → PgVector,
 * otherwise LibSQLVector on the same LibSQL file storage picked.
 *
 * NOTE (spec 03 wave): the DATABASE_URL/LIBSQL_URL resolution is duplicated
 * from storage.ts on purpose (vertical-slice rule — this module must not
 * reach into storage internals); the orchestrator unifies both with db.ts.
 */

export const VECTOR_STORE_NAME = 'mastra-vectors';

export type Vector = PgVector | LibSQLVector;
export type VectorKind = 'pgvector' | 'libsql';

export interface VectorResolution {
  /** null only when recall/RAG is fully off (SEMANTIC_RECALL=off) */
  store: Vector | null;
  kind: VectorKind;
}

/** Canonical inactive string (spec 03 §3.9; D3 wording). */
export const OFF_BANNER_DETAIL = 'off (no embedder)';

let embedderAvailable = true;
let degradeWarned = false;
let resolvedAtBoot: boolean | undefined;

/**
 * Lazy health flag: false when resolveEmbedder() resolves 'none' (boot-
 * knowable; cached on first call) or after the first embedder runtime
 * failure (latched ONCE — no per-request retry storm, Scenario 4c).
 */
export function semanticRecallAvailable(): boolean {
  if (!embedderAvailable) return false;
  resolvedAtBoot ??= resolveEmbedder().source !== 'none';
  return resolvedAtBoot;
}

/** Flip the latch + emit the canonical warn line exactly once per process. */
export function markEmbedderUnavailable(reason: string): void {
  embedderAvailable = false;
  if (degradeWarned) return;
  degradeWarned = true;
  logger.warn(`Semantic recall: ${OFF_BANNER_DETAIL} — ${reason}`);
}

/** Test-only: reset the module latch between scenarios. */
export function __resetEmbedderHealthForTests(): void {
  embedderAvailable = true;
  degradeWarned = false;
  resolvedAtBoot = undefined;
}

/**
 * Test seam — replaces the on-disk fastembed cache check (never the
 * availability flag itself), same DI spirit as `DomainMemoryDeps`.
 */
export interface VectorDeps {
  fastembedCacheReady?: () => boolean;
}

/**
 * Build the vector store + push the 'Vector store', 'Semantic recall' and
 * 'Knowledge RAG' ServiceStatus lines in EVERY branch (shared/AGENTS.md).
 */
export function buildVectors(services: ServiceRegistry, deps: VectorDeps = {}): VectorResolution {
  const resolution = resolveEmbedder();

  // Boot-knowable after all: fastembed builds its ONNX session lazily, but the
  // artifacts it needs are plain files. A poisoned cache (model dir present,
  // `model.onnx` absent — an interrupted download/extraction is never retried by
  // the package) would otherwise only surface inside the first chat turn. Latch
  // it here so the banner tells the truth from boot (gotcha #13).
  if (resolution.source === 'fastembed' && !(deps.fastembedCacheReady ?? fastembedCacheReady)()) {
    markEmbedderUnavailable(
      `fastembed model not cached at ${FASTEMBED_MODEL_FILE} — run \`npm run warm:embeddings\``
    );
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && databaseUrl.startsWith('postgres')) {
    services.push({
      name: 'Vector store',
      active: true,
      detail: 'PgVector (DATABASE_URL) — hnsw/dotproduct',
    });
    pushRecallBanner(services, resolution);
    return {
      store: new PgVector({ id: VECTOR_STORE_NAME, connectionString: databaseUrl }),
      kind: 'pgvector',
    };
  }

  // Same url buildStorage picked: LIBSQL_URL ?? 'file:./mastra.db'.
  const libsqlUrl = process.env.LIBSQL_URL ?? 'file:./mastra.db';
  services.push({
    name: 'Vector store',
    active: true,
    detail: `LibSQLVector (${libsqlUrl} — cosine)`,
  });
  pushRecallBanner(services, resolution);
  return { store: new LibSQLVector({ id: VECTOR_STORE_NAME, url: libsqlUrl }), kind: 'libsql' };
}

/**
 * 'Semantic recall' + 'Knowledge RAG' lines (spec 03 §3.9). Names fixed;
 * detail derived from the resolution — spacing is rendered by
 * service-status.ts padEnd(16), NEVER hand-typed here.
 */
export function pushRecallBanner(services: ServiceRegistry, r: EmbedderResolution): void {
  const on = semanticRecallAvailable();

  if (on) {
    services.push({
      name: 'Semantic recall',
      active: true,
      detail: `on (${r.detail} · scope:resource)`,
    });
    services.push({
      name: 'Knowledge RAG',
      active: true,
      detail: 'tool search_knowledge registered (opt-in per agent: connectors.rag)',
    });
  } else {
    services.push({ name: 'Semantic recall', active: false, detail: OFF_BANNER_DETAIL });
    services.push({ name: 'Knowledge RAG', active: false, detail: OFF_BANNER_DETAIL });
  }
}

/** Memory options accepted by every domain agent (spec 03 §3.5). */
export interface DomainMemoryOptions {
  generateTitle?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  observationalMemory?: any;
}

/**
 * Test seam (Scenarios 4b/4c) — same DI spirit as the §3.6 workflow factory:
 * deps.embedder replaces IDENTITY, never AVAILABILITY.
 */
export interface DomainMemoryDeps {
  embedder?: MastraEmbeddingModel<string>;
  vector?: Vector;
}

/** Shared semantic-recall config. */
export const RECALL_OPTIONS: SemanticRecall = {
  topK: 4,
  messageRange: 2,
  scope: 'resource',
  indexConfig: { type: 'hnsw', metric: 'dotproduct', hnsw: { m: 16, efConstruction: 64 } },
  // indexName intentionally UNSET → the runtime derives it from the probed
  // embedding DIMENSION (memory_messages[_<dim>]); same-dim embedder swaps
  // then SHARE the index — gotcha #G3.
};

/**
 * Wrap an embedder so the FIRST runtime failure latches the module health
 * flag (Scenario 4c) — the error still propagates so the failing operation
 * surfaces normally, but every later construction sees recall OFF with no
 * further embed attempt (one canonical warn, no retry storm).
 */
type EmbedderRecord = {
  doEmbed?: (args: { values: string[] }) => PromiseLike<unknown>;
} & Record<string, unknown>;

function guardEmbedder(model: MastraEmbeddingModel<string>): MastraEmbeddingModel<string> {
  const target = model as unknown as EmbedderRecord;
  return new Proxy(target, {
    get(receiver, prop) {
      if (prop === 'doEmbed') {
        return async (args: { values: string[] }) => {
          if (!embedderAvailable) {
            // Latched already: short-circuit WITHOUT touching the (failing)
            // real embedder — zero retries, zero attempts.
            throw new Error(
              'Semantic recall disabled: embedder previously failed (offline/unavailable)'
            );
          }
          try {
            const embed = target.doEmbed;
            if (!embed) throw new Error('embedder has no doEmbed');
            return await embed.call(target, args);
          } catch (error) {
            markEmbedderUnavailable(error instanceof Error ? error.message : String(error));
            throw error;
          }
        };
      }
      const value = Reflect.get(receiver, prop);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as unknown as MastraEmbeddingModel<string>;
}

/**
 * One-shot async readiness probe, run BEFORE Memory is constructed.
 *
 * Mastra resolves the embedder's dimension INSIDE the turn
 * (`Memory.getInputProcessors` → `getEmbeddingDimension` → `embedder.doEmbed`),
 * so a broken embedder used to 500 the in-flight request even though the latch
 * had already warned. Probing here absorbs the failure: the latch flips (one
 * canonical warn), this Memory is built with recall OFF, and the turn continues
 * on plain history — the ADR-006 "never a crash" contract.
 *
 * Memoized once per process: zero cost after the first turn (fastembed also
 * memoizes the ONNX session it builds).
 */
let readinessProbe: Promise<void> | undefined;

async function ensureEmbedderReady(guarded: MastraEmbeddingModel<string>): Promise<void> {
  if (!semanticRecallAvailable()) return;
  readinessProbe ??= (async () => {
    try {
      await guarded.doEmbed({ values: ['ping'] });
    } catch {
      // guardEmbedder already latched + warned. Swallowed ON PURPOSE: the
      // failure must degrade the turn, never end it.
    }
  })();
  await readinessProbe;
}

/**
 * AgentConfig.memory DynamicArgument factory: Memory is built AFTER the
 * Mastra instance exists, so recall availability is evaluated per-request.
 *
 * The identity-vs-availability fix: `available` comes from
 * semanticRecallAvailable() ONLY — a deps.embedder stub (Scenario 4b)
 * replaces the embedder identity but can NEVER turn recall on when the
 * kill-switch/latch says off.
 *
 * NB: gated non-throwing read — mastra.getVector() THROWS MastraError on a
 * missing key and the Mastra ctor silently skips null vector entries, so the
 * registry key can legitimately be absent (fully-off state).
 */
export function buildDomainMemory(
  options: DomainMemoryOptions,
  deps?: DomainMemoryDeps
): (ctx: { requestContext: RequestContext; mastra?: Mastra }) => Promise<Memory> {
  return async ({ mastra }) => {
    // Recall already off (kill-switch or an earlier failure): nothing to probe
    // and nothing to attach — and resolveEmbedder() stays out of the per-turn
    // path, so its off-reason warn does not repeat on every request.
    const requested = semanticRecallAvailable()
      ? (deps?.embedder ?? resolveEmbedder().passage)
      : undefined;

    if (requested) await ensureEmbedderReady(guardEmbedder(requested));

    // Re-read AFTER the probe: the probe above is the only thing that can flip
    // availability inside this call.
    const available = semanticRecallAvailable();
    const vector = available
      ? (deps?.vector ?? mastra?.listVectors?.()?.[VECTOR_STORE_NAME])
      : undefined;

    // Mastra HARD-THROWS on `semanticRecall` without a vector store ("Semantic
    // recall requires a vector store to be configured") — and the registry read
    // can legitimately come back empty: a standalone agent (tests, scripts, the
    // stdio MCP surface) has no Mastra instance, and the ctor skips null vector
    // entries. Recall needs BOTH halves, so the single decision below is also
    // the guard: no usable embedder or no store ⇒ plain history, never a throw.
    const recallEmbedder =
      available && requested && vector !== undefined ? guardEmbedder(requested) : undefined;

    return new Memory({
      ...(vector ? { vector } : {}),
      ...(recallEmbedder ? { embedder: recallEmbedder } : {}),
      options: {
        lastMessages: 10,
        semanticRecall: recallEmbedder ? RECALL_OPTIONS : false,
        ...options,
      },
    });
  };
}
