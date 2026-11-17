// Mastra RAG: https://mastra.ai/docs/rag/overview
import { createVectorQueryTool } from '@mastra/rag';
import type { MastraEmbeddingModel } from '@mastra/core/vector';
import { getVectorStore, resolveVectors, type Vector } from '../../../shared/config/vectors';
import { KNOWLEDGE_INDEX_NAME } from '../config';

export function createKnowledgeQueryTool(
  deps: { embedder?: MastraEmbeddingModel<string>; vector?: Vector } = {}
) {
  const embedder = deps.embedder ?? resolveVectors().embedder;
  const vectorStore = deps.vector ?? getVectorStore();
  if (!embedder || !vectorStore) return null;

  return createVectorQueryTool({
    id: 'search_knowledge',
    description:
      'Semantic search over the documents indexed by the index-knowledge workflow (project knowledge base). Returns the most relevant chunks with their source metadata.',
    indexName: KNOWLEDGE_INDEX_NAME,
    model: embedder,
    vectorStore,
  });
}

export const knowledgeQueryTool = createKnowledgeQueryTool();
