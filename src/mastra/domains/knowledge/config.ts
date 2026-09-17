/**
 * Knowledge domain constants (spec 03 §3.6). Values only — no logic here.
 *
 * `KNOWLEDGE_INDEX_NAME` is a contract shared with the query tool and the
 * composition root (`src/mastra/index.ts`); changing it silently breaks the
 * `search_knowledge` registry entry.
 */

/** Index the knowledge slice writes into — the query tool shares the name. */
export const KNOWLEDGE_INDEX_NAME = 'knowledge_docs';

/** Batch ceiling per doEmbed call (AI-SDK maxEmbeddingsPerCall, spec 03 §3.6). */
export const EMBED_BATCH = 256;

/** Recursive-chunking window, in characters (MDocument). */
export const CHUNK_MAX_SIZE = 512;

/** Overlap between consecutive chunks, in characters. */
export const CHUNK_OVERLAP = 50;

/** HNSW index config applied when `store-chunks` creates a PgVector index. */
export const KNOWLEDGE_HNSW_INDEX_CONFIG = {
  type: 'hnsw',
  hnsw: { m: 16, efConstruction: 64 },
} as const;
