export {
  indexKnowledgeWorkflow,
  createIndexKnowledgeWorkflow,
  knowledgeIndexingAvailable,
  KNOWLEDGE_INDEX_NAME,
  VectorDimensionMismatchError,
  type IndexKnowledgeDeps,
} from './workflows/index-knowledge';
export { knowledgeQueryTool, createKnowledgeQueryTool } from './tools/knowledge-query';
export { knowledgeDocSchema, knowledgeChunkSchema, type KnowledgeDoc, type KnowledgeChunk } from './entities/document';
export * from './events';
