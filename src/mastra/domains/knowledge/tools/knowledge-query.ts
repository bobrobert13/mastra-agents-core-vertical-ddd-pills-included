import { createVectorQueryTool } from '@mastra/rag';
import type { MastraEmbeddingModel } from '@mastra/core/vector';

import { resolveEmbedder } from '../../../shared/config/model';
import {
  VECTOR_STORE_NAME,
  semanticRecallAvailable,
  type Vector,
} from '../../../shared/config/vectors';
import { KNOWLEDGE_INDEX_NAME } from '../workflows/index-knowledge';

/**
 * Wrapper around `createVectorQueryTool` (spec 03 §3.6). Registered on the
 * Mastra top-level `tools` registry under 'search_knowledge' by the
 * composition root; consumers resolve it through `mastra.listTools()` (the
 * NON-THROWING read — `getTool` throws MastraError on a missing key).
 *
 * Returns null when no embedder resolves (Scenarios 4a/4b): the registry
 * entry — and therefore the research agent's `search_knowledge` tool —
 * simply does not exist. Never throws.
 */
export function createKnowledgeQueryTool(
  deps: { embedder?: MastraEmbeddingModel<string>; vector?: Vector } = {}
) {
  if (!semanticRecallAvailable()) {
    return null;
  }
  const model = deps.embedder ?? resolveEmbedder().query;
  if (!model) {
    return null;
  }

  return createVectorQueryTool({
    id: 'search_knowledge',
    description:
      'Semantic search over the documents indexed by the index-knowledge workflow (project knowledge base). Returns the most relevant chunks with their source metadata.',
    indexName: KNOWLEDGE_INDEX_NAME,
    model,
    // Production: resolve by registry name through the Mastra instance.
    // Tests: inject the store instance (offline E2E seam, §3.6 DI spirit).
    ...(deps.vector ? { vectorStore: deps.vector } : { vectorStoreName: VECTOR_STORE_NAME }),
    // Rerank OFF by default: it would need an LLM call per search and break the
    // zero-key promise (spec 03 Phase-4 open question: EMBEDDING_RERANK_MODEL).
  });
}

/** Production instance for the composition root (`null` on every degrade path). */
export const knowledgeQueryTool = createKnowledgeQueryTool();
