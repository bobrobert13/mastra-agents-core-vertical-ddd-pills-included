import { createStep } from '@mastra/core/workflows';
import { PgVector } from '@mastra/pg';

import { resolveEmbedder } from '../../../../shared/config/model';
import { VECTOR_STORE_NAME, type Vector } from '../../../../shared/config/vectors';
import { eventBus, makeEvent } from '../../../../shared/events';
import { logger } from '../../../../shared/logger';
import { KNOWLEDGE_HNSW_INDEX_CONFIG, KNOWLEDGE_INDEX_NAME } from '../../config';
import { VectorDimensionMismatchError } from '../../errors';
import { knowledgeIndexedEvent } from '../../events';
import { embeddedDocSchema, workflowOutputSchema, type IndexKnowledgeDeps } from '../schemas';

/**
 * `store-chunks` — ensure the index (fail-fast on a stored-dimension mismatch
 * BEFORE any write) then idempotent upsert under deterministic ids.
 */

/** Store instance for a step: injected dep first, else the Mastra registry (non-throwing read). */
function resolveVectorStore(
  deps: IndexKnowledgeDeps,
  mastra?: { listVectors?: () => Record<string, unknown> }
): Vector {
  const store =
    deps.vector ??
    (mastra?.listVectors?.() as Record<string, Vector> | undefined)?.[VECTOR_STORE_NAME];
  if (!store) {
    throw new Error(
      `index-knowledge: no vector store — pass deps.vector or register "${VECTOR_STORE_NAME}" on the Mastra instance`
    );
  }
  return store;
}

export function createStoreChunksStep(deps: IndexKnowledgeDeps) {
  return createStep({
    id: 'store-chunks',
    inputSchema: embeddedDocSchema,
    outputSchema: workflowOutputSchema,
    execute: async ({ inputData, mastra }) => {
      const store = resolveVectorStore(
        deps,
        mastra as { listVectors?: () => Record<string, unknown> } | undefined
      );
      const { docId, source, chunks, vectors, dimension } = inputData;
      const embedderDetail = deps.embedderDetail ?? resolveEmbedder().detail ?? 'unknown-embedder';

      const indexes = await store.listIndexes();
      if (!indexes.includes(KNOWLEDGE_INDEX_NAME)) {
        await store.createIndex({
          indexName: KNOWLEDGE_INDEX_NAME,
          dimension,
          metric: 'cosine',
          ...(store instanceof PgVector && { indexConfig: KNOWLEDGE_HNSW_INDEX_CONFIG }),
        });
      } else {
        const stats = await store.describeIndex({ indexName: KNOWLEDGE_INDEX_NAME });
        if (stats.dimension !== dimension) {
          // Mismatch check PRECEDES upsert — nothing is written (Scenario 6).
          throw new VectorDimensionMismatchError(KNOWLEDGE_INDEX_NAME, stats.dimension, dimension);
        }
      }

      // Deterministic ids → re-indexing is idempotent.
      await store.upsert({
        indexName: KNOWLEDGE_INDEX_NAME,
        vectors,
        ids: chunks.map(c => c.chunkId),
        metadata: chunks.map(c => ({
          text: c.text,
          docId,
          chunkIndex: c.index,
          source,
          embedder: embedderDetail,
        })),
      });

      logger.info(
        `knowledge: indexed ${chunks.length} chunks of "${docId}" into ${KNOWLEDGE_INDEX_NAME} (${dimension}d)`
      );
      void eventBus.publish(
        makeEvent(knowledgeIndexedEvent, {
          docId,
          indexName: KNOWLEDGE_INDEX_NAME,
          dimension,
          chunkCount: chunks.length,
          skippedChunks: 0,
          timestamp: new Date(),
        })
      );

      return {
        docId,
        indexName: KNOWLEDGE_INDEX_NAME,
        dimension,
        chunkCount: chunks.length,
        skippedChunks: 0,
      };
    },
  });
}
