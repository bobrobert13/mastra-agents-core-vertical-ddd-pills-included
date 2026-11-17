// Mastra workflows: https://mastra.ai/docs/workflows/overview — RAG: https://mastra.ai/docs/rag/overview
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { PgVector } from '@mastra/pg';
import { MDocument } from '@mastra/rag';
import type { MastraEmbeddingModel } from '@mastra/core/vector';
import { z } from 'zod';
import { getVectorStore, resolveVectors, type Vector } from '../../../shared/config/vectors';
import { logger } from '../../../shared/logger';
import {
  CHUNK_MAX_SIZE,
  CHUNK_OVERLAP,
  EMBED_BATCH,
  KNOWLEDGE_HNSW_INDEX_CONFIG,
  KNOWLEDGE_INDEX_NAME,
} from '../config';

export { KNOWLEDGE_INDEX_NAME } from '../config';

export interface IndexKnowledgeDeps {
  /** Deterministic stub embedder (tests); default = config-resolved model. */
  embedder?: MastraEmbeddingModel<string>;
  /** Vector store instance (tests); default = the shared store. */
  vector?: Vector;
}

const contentTypeSchema = z.enum(['text', 'markdown', 'html']);

const workflowInputSchema = z
  .object({
    source: z.enum(['path', 'inline']),
    path: z.string().optional(),
    content: z.string().optional(),
    contentType: contentTypeSchema.default('text'),
    docId: z.string().min(1).optional(),
  })
  .refine(i => (i.source === 'path' ? !!i.path : true), {
    message: "path is required when source === 'path'",
  })
  .refine(i => (i.source === 'inline' ? !!i.content : true), {
    message: "content is required when source === 'inline'",
  });

const workflowOutputSchema = z.object({
  docId: z.string(),
  indexName: z.string(),
  dimension: z.number().int(),
  chunkCount: z.number().int(),
  skippedChunks: z.number().int(),
});

const readDocSchema = z.object({
  docId: z.string(),
  text: z.string(),
  contentType: contentTypeSchema,
  source: z.string(),
});

const chunkItemSchema = z.object({
  chunkId: z.string(),
  text: z.string(),
  index: z.number().int(),
});

const chunkedDocSchema = z.object({
  docId: z.string(),
  source: z.string(),
  chunks: z.array(chunkItemSchema),
});

const embeddedDocSchema = chunkedDocSchema.extend({
  vectors: z.array(z.array(z.number())),
  dimension: z.number().int(),
});

function contentTypeFromExtension(filePath: string, fallback: 'text' | 'markdown' | 'html') {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.html' || ext === '.htm') return 'html';
  return fallback;
}

const readDocumentStep = createStep({
  id: 'read-document',
  inputSchema: workflowInputSchema,
  outputSchema: readDocSchema,
  execute: async ({ inputData }) => {
    let text: string;
    let source: string;
    let contentType = inputData.contentType;

    if (inputData.source === 'path') {
      const basePath = path.resolve(process.env.WORKSPACE_ROOT?.trim() || 'workspace');
      const resolved = path.resolve(basePath, inputData.path ?? '');
      if (resolved !== basePath && !resolved.startsWith(basePath + path.sep)) {
        throw new Error(
          `index-knowledge: path "${resolved}" escapes the workspace root (path containment)`
        );
      }
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

const chunkDocumentStep = createStep({
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

    const sections = await doc.chunk({
      strategy: 'recursive',
      maxSize: CHUNK_MAX_SIZE,
      overlap: CHUNK_OVERLAP,
    });
    const chunks = sections
      .map((section, index) => ({
        chunkId: `${inputData.docId}:${index}`,
        text: section.text,
        index,
      }))
      .filter(chunk => chunk.text.trim().length > 0);

    return { docId: inputData.docId, source: inputData.source, chunks };
  },
});

function createEmbedChunksStep(deps: IndexKnowledgeDeps) {
  return createStep({
    id: 'embed-chunks',
    inputSchema: chunkedDocSchema,
    outputSchema: embeddedDocSchema,
    execute: async ({ inputData }) => {
      const embedder = deps.embedder ?? resolveVectors().embedder;
      if (!embedder) {
        throw new Error('index-knowledge: no embedder. Set EMBEDDING_MODEL or pass deps.embedder.');
      }

      const values = inputData.chunks.map(chunk => chunk.text);
      const vectors: number[][] = [];
      for (let i = 0; i < values.length; i += EMBED_BATCH) {
        const batch = values.slice(i, i + EMBED_BATCH);
        const result = await embedder.doEmbed({ values: batch });
        vectors.push(...result.embeddings);
      }

      const dimension = vectors[0]?.length ?? 0;
      if (!vectors.length || !dimension) {
        throw new Error('index-knowledge: embed-chunks produced no vectors');
      }
      return { ...inputData, vectors, dimension };
    },
  });
}

function createStoreChunksStep(deps: IndexKnowledgeDeps) {
  return createStep({
    id: 'store-chunks',
    inputSchema: embeddedDocSchema,
    outputSchema: workflowOutputSchema,
    execute: async ({ inputData }) => {
      const store = deps.vector ?? getVectorStore();
      if (!store) {
        throw new Error('index-knowledge: no vector store. Set EMBEDDING_MODEL/DATABASE_URL.');
      }
      const { docId, source, chunks, vectors, dimension } = inputData;

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
          throw new Error(
            `Vector dimension mismatch: index=${stats.dimension} embedder=${dimension}`
          );
        }
      }

      await store.upsert({
        indexName: KNOWLEDGE_INDEX_NAME,
        vectors,
        ids: chunks.map(chunk => chunk.chunkId),
        metadata: chunks.map(chunk => ({
          text: chunk.text,
          docId,
          chunkIndex: chunk.index,
          source,
          embedder: deps.embedder ? 'custom' : (process.env.EMBEDDING_MODEL ?? 'unknown'),
        })),
      });

      logger.info(
        `knowledge: indexed ${chunks.length} chunks of "${docId}" into ${KNOWLEDGE_INDEX_NAME} (${dimension}d)`
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

export function createIndexKnowledgeWorkflow(deps: IndexKnowledgeDeps = {}) {
  return createWorkflow({
    id: 'index-knowledge',
    inputSchema: workflowInputSchema,
    outputSchema: workflowOutputSchema,
    description:
      'Index a document (path or inline) into the knowledge vector index: read → chunk → embed → store.',
  })
    .then(readDocumentStep)
    .then(chunkDocumentStep)
    .then(createEmbedChunksStep(deps))
    .then(createStoreChunksStep(deps))
    .commit();
}

export const indexKnowledgeWorkflow = createIndexKnowledgeWorkflow();
