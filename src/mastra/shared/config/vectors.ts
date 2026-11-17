// Mastra vectors / RAG: https://mastra.ai/docs/rag/overview
import { ModelRouterEmbeddingModel } from '@mastra/core/llm';
import type { SemanticRecall } from '@mastra/core/memory';
import type { MastraEmbeddingModel } from '@mastra/core/vector';
import { LibSQLVector } from '@mastra/libsql';
import { PgVector } from '@mastra/pg';

export const VECTOR_STORE_NAME = 'mastra-vectors';
export type Vector = PgVector | LibSQLVector;

export interface VectorResolution {
  store?: Vector;
  embedder?: MastraEmbeddingModel<string>;
}

export const RECALL_OPTIONS: SemanticRecall = {
  topK: 4,
  messageRange: 2,
  scope: 'resource',
  indexConfig: { type: 'hnsw', metric: 'dotproduct', hnsw: { m: 16, efConstruction: 64 } },
};

let cached: VectorResolution | undefined;

export function resolveEmbedder(): MastraEmbeddingModel<string> | undefined {
  if (process.env.SEMANTIC_RECALL === 'off') return undefined;
  const model = process.env.EMBEDDING_MODEL?.trim();
  return model ? new ModelRouterEmbeddingModel(model) : undefined;
}

export function resolveVectors(): VectorResolution {
  if (cached) return cached;
  const embedder = resolveEmbedder();
  if (!embedder) return (cached = {});
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const store = databaseUrl?.startsWith('postgres')
    ? new PgVector({ id: VECTOR_STORE_NAME, connectionString: databaseUrl })
    : new LibSQLVector({
        id: VECTOR_STORE_NAME,
        url: process.env.LIBSQL_URL?.trim() || 'file:./mastra.db',
      });
  return (cached = { store, embedder });
}

export function semanticRecallAvailable(): boolean {
  const { store, embedder } = resolveVectors();
  return Boolean(store && embedder);
}

export function getVectorStore(): Vector | undefined {
  return resolveVectors().store;
}
