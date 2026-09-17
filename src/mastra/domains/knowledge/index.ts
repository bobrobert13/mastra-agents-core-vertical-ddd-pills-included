export {
  indexKnowledgeWorkflow,
  createIndexKnowledgeWorkflow,
  knowledgeIndexingAvailable,
  KNOWLEDGE_INDEX_NAME,
  VectorDimensionMismatchError,
  type IndexKnowledgeDeps,
} from './workflows/index-knowledge';
export {
  KnowledgeError,
  EmbedderUnavailableError,
  EmbedFailureError,
  VectorStoreUnavailableError,
  KnowledgeSourceError,
  toKnowledgeError,
} from './handlers/errors';
export {
  EMBED_BATCH,
  CHUNK_MAX_SIZE,
  CHUNK_OVERLAP,
  KNOWLEDGE_HNSW_INDEX_CONFIG,
} from './config';
export { knowledgeQueryTool, createKnowledgeQueryTool } from './tools/knowledge-query';
export {
  knowledgeDocSchema,
  knowledgeChunkSchema,
  type KnowledgeDoc,
  type KnowledgeChunk,
} from './entities/document';
export * from './events';
