import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { createStep, createWorkflow } from '@mastra/core/workflows';
import { MDocument } from '@mastra/rag';
import { PgVector } from '@mastra/pg';

import { logger } from '../../../shared/logger';
import { eventBus, makeEvent } from '../../../shared/events';
import { resolveEmbedder } from '../../../shared/config/model';
import {
  VECTOR_STORE_NAME,
  markEmbedderUnavailable,
  semanticRecallAvailable,
  type Vector,
} from '../../../shared/config/vectors';
import type { KnowledgeContentType } from '../entities/document';
import { knowledgeIndexedEvent, knowledgeIndexFailedEvent } from '../events';
import {
  chunkedDocSchema,
  embeddedDocSchema,
  readDocSchema,
  workflowInputSchema,
  workflowOutputSchema,
  type IndexKnowledgeDeps,
} from './schemas';

export type { IndexKnowledgeDeps };

/** Index the knowledge slice writes into — the query tool shares the name. */
export const KNOWLEDGE_INDEX_NAME = 'knowledge_docs';

/** Batch ceiling per doEmbed call (AI-SDK maxEmbeddingsPerCall, spec 03 §3.6). */
const EMBED_BATCH = 256;

/**
 * Thrown by `store-chunks` when an existing index was created by a different-
 * dimension embedder (Scenario 6). Remediation: delete the index and re-index,
 * or revert EMBEDDING_MODEL (gotcha #G3).
 */
export class VectorDimensionMismatchError extends Error {
  readonly storedDimension: number;
  readonly requestedDimension: number;
  readonly indexName: string;

  constructor(indexName: string, storedDimension: number, requestedDimension: number) {
    super(
      `VectorDimensionMismatchError: index "${indexName}" stores ${storedDimension}d vectors ` +
        `but the current embedder produces ${requestedDimension}d. An index is bound to one ` +
        `embedder dimension forever (gotcha #G3). Remediation: delete index "${indexName}" and ` +
        `re-run the index-knowledge workflow, or revert EMBEDDING_MODEL to the original embedder.`
    );
    this.name = 'VectorDimensionMismatchError';
    this.storedDimension = storedDimension;
    this.requestedDimension = requestedDimension;
    this.indexName = indexName;
  }
}

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

/** Path-containment check: workspace root (process cwd) + workspace/ dir only. */
function assertInsideWorkspace(resolved: string): void {
  const roots = [process.cwd(), path.join(process.cwd(), 'workspace')];
  const inside = roots.some(root => resolved === root || resolved.startsWith(root + path.sep));
  if (!inside) {
    throw new Error(
      `index-knowledge: path "${resolved}" escapes the workspace root (path containment)`
    );
  }
}

function contentTypeFromExtension(
  filePath: string,
  fallback: KnowledgeContentType
): KnowledgeContentType {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.html' || ext === '.htm') return 'html';
  return fallback;
}

// --- Factory (test seam per spec 03 §3.6) ------------------------------------

export function createIndexKnowledgeWorkflow(deps: IndexKnowledgeDeps = {}) {
  // Step 1 — read the document from path or inline content.
  const readDocument = createStep({
    id: 'read-document',
    inputSchema: workflowInputSchema,
    outputSchema: readDocSchema,
    execute: async ({ inputData }) => {
      let text: string;
      let source: string;
      let contentType: KnowledgeContentType = inputData.contentType;

      if (inputData.source === 'path') {
        const resolved = path.resolve(inputData.path ?? '');
        assertInsideWorkspace(resolved);
        text = await readFile(resolved, 'utf8');
        source = resolved;
        contentType = contentTypeFromExtension(resolved, contentType);
      } else {
        text = inputData.content ?? '';
        source = 'inline';
      }

      const docId = inputData.docId ?? createHash('sha256').update(text).digest('hex').slice(0, 16);
      return { docId, text, contentType, source };
    },
  });

  // Step 2 — chunk with MDocument (recursive 512/50, spec 03 §3.6).
  const chunkDocument = createStep({
    id: 'chunk-document',
    inputSchema: readDocSchema,
    outputSchema: chunkedDocSchema,
    execute: async ({ inputData }) => {
      const doc =
        inputData.contentType === 'markdown'
          ? MDocument.fromMarkdown(inputData.text)
          : inputData.contentType === 'html'
            ? MDocument.fromHTML(inputData.text)
            : MDocument.fromText(inputData.text);

      const sections = await doc.chunk({ strategy: 'recursive', maxSize: 512, overlap: 50 });
      const chunks = sections
        .map((section, index) => ({
          chunkId: `${inputData.docId}:${index}`,
          text: section.text,
          index,
        }))
        .filter(c => c.text.trim().length > 0);

      return { docId: inputData.docId, source: inputData.source, chunks };
    },
  });

  // Step 3 — embed batches with the resolved passage model (or injected stub).
  const embedChunks = createStep({
    id: 'embed-chunks',
    inputSchema: chunkedDocSchema,
    outputSchema: embeddedDocSchema,
    execute: async ({ inputData }) => {
      const embedder = deps.embedder ?? resolveEmbedder().passage;
      if (!embedder) {
        throw new Error(
          'index-knowledge: embed-chunks — no embedder resolved (see banner, "Semantic recall: off (no embedder)")'
        );
      }

      const values = inputData.chunks.map(c => c.text);
      const vectors: number[][] = [];
      try {
        for (let i = 0; i < values.length; i += EMBED_BATCH) {
          const batch = values.slice(i, i + EMBED_BATCH);
          // doEmbed directly: works across AI-SDK spec versions without the `ai` peer (spec 03 §3.6).
          const result = await embedder.doEmbed({ values: batch });
          vectors.push(...result.embeddings);
        }
      } catch (error) {
        // Runtime embed failure: latch off + fail the step (workflow error, not a crash).
        markEmbedderUnavailable(error instanceof Error ? error.message : String(error));
        const reason = error instanceof Error ? error.message : String(error);
        void eventBus.publish(
          makeEvent(knowledgeIndexFailedEvent, {
            docId: inputData.docId,
            stage: 'embed',
            reason,
            timestamp: new Date(),
          })
        );
        throw error;
      }

      const dimension = vectors[0]?.length ?? 0;
      if (!dimension) throw new Error('index-knowledge: embed-chunks produced no vectors');
      return { ...inputData, vectors, dimension };
    },
  });

  // Step 4 — ensure index (dimension fail-fast) + idempotent upsert.
  const storeChunks = createStep({
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
          ...(store instanceof PgVector && {
            indexConfig: { type: 'hnsw', hnsw: { m: 16, efConstruction: 64 } },
          }),
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

  return createWorkflow({
    id: 'index-knowledge',
    inputSchema: workflowInputSchema,
    outputSchema: workflowOutputSchema,
    description:
      'Index a document (path or inline) into the knowledge vector index: read → chunk → embed → store.',
  })
    .then(readDocument)
    .then(chunkDocument)
    .then(embedChunks)
    .then(storeChunks)
    .commit();
}

/** Production workflow: config-resolved embedder + registry-resolved vector store. */
export const indexKnowledgeWorkflow = createIndexKnowledgeWorkflow();

/** Guard used by the composition root: workflow is only useful with an embedder. */
export const knowledgeIndexingAvailable = (): boolean => semanticRecallAvailable();
