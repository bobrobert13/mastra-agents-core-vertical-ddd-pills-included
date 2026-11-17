/** Index the knowledge slice writes into — the query tool shares the name. */
export const KNOWLEDGE_INDEX_NAME = 'knowledge_docs';

/** Batch ceiling per doEmbed call (AI-SDK maxEmbeddingsPerCall). */
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
