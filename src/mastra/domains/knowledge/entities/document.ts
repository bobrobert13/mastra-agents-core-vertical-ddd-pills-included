import { z } from 'zod';

/**
 * KnowledgeDoc entity (spec 03 §3.6): plain data + zod, shared by the
 * index-knowledge workflow steps and the query tool contracts.
 */

export const knowledgeContentTypeSchema = z.enum(['text', 'markdown', 'html']);
export type KnowledgeContentType = z.infer<typeof knowledgeContentTypeSchema>;

export const knowledgeChunkSchema = z.object({
  chunkId: z.string(),
  text: z.string(),
  index: z.number().int(),
});
export type KnowledgeChunk = z.infer<typeof knowledgeChunkSchema>;

export const knowledgeDocSchema = z.object({
  docId: z.string(),
  source: z.string(),
  contentType: knowledgeContentTypeSchema,
  chunks: z.array(knowledgeChunkSchema),
});
export type KnowledgeDoc = z.infer<typeof knowledgeDocSchema>;
