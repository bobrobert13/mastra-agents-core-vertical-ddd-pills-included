import type { MastraEmbeddingModel } from '@mastra/core/vector';
import { z } from 'zod';
import type { Vector } from '../../../shared/config/vectors';
import { knowledgeContentTypeSchema } from '../entities/document';

/**
 * Shared Zod schemas for the index-knowledge workflow (spec 03 §3.6).
 *
 * Extracted so the chunk shape is declared ONCE — it was previously copied
 * identically into four step schemas (chunkDocument output, embedChunks
 * input + output, storeChunks input), where editing one and missing the
 * others would silently break the chain.
 */

/** Test/DI seam: embedder + vector-store overrides for deterministic runs. */
export interface IndexKnowledgeDeps {
  /** Deterministic stub embedder (tests); default = config-resolved passage model. */
  embedder?: MastraEmbeddingModel<string>;
  /** Vector store instance (tests); default = the 'mastra-vectors' registry entry. */
  vector?: Vector;
  /** Embedder banner detail for chunk metadata provenance; default from config. */
  embedderDetail?: string;
}

/** One embedded document chunk. `chunkId` is deterministic: `<docId>:<index>`. */
export const chunkItemSchema = z.object({
  chunkId: z.string(),
  text: z.string(),
  index: z.number().int(),
});

export const chunksSchema = z.array(chunkItemSchema);

export const workflowInputSchema = z
  .object({
    source: z.enum(['path', 'inline']),
    path: z.string().optional(),
    content: z.string().optional(),
    contentType: knowledgeContentTypeSchema.default('text'),
    docId: z.string().min(1).optional(),
  })
  .refine(i => (i.source === 'path' ? !!i.path : true), {
    message: "path is required when source === 'path'",
  })
  .refine(i => (i.source === 'inline' ? !!i.content : true), {
    message: "content is required when source === 'inline'",
  });

export const workflowOutputSchema = z.object({
  docId: z.string(),
  indexName: z.string(),
  dimension: z.number().int(),
  chunkCount: z.number().int(),
  skippedChunks: z.number().int(),
});

/** Document as read from disk/inline — `read-document` output = `chunk-document` input. */
export const readDocSchema = z.object({
  docId: z.string(),
  text: z.string(),
  contentType: knowledgeContentTypeSchema,
  source: z.string(),
});

/** Intermediate shape shared by the chunk → embed → store step chain. */
export const chunkedDocSchema = z.object({
  docId: z.string(),
  source: z.string(),
  chunks: chunksSchema,
});

export const embeddedDocSchema = chunkedDocSchema.extend({
  vectors: z.array(z.array(z.number())),
  dimension: z.number().int(),
});
