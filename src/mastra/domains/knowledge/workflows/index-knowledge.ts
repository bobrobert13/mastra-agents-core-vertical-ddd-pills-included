import { createWorkflow } from '@mastra/core/workflows';

import { semanticRecallAvailable } from '../../../shared/config/vectors';
import { workflowInputSchema, workflowOutputSchema, type IndexKnowledgeDeps } from './schemas';
import { createChunkDocumentStep } from './steps/chunk-document';
import { createEmbedChunksStep } from './steps/embed-chunks';
import { createReadDocumentStep } from './steps/read-document';
import { createStoreChunksStep } from './steps/store-chunks';

/**
 * `index-knowledge` composition root (spec 03 §3.6). The four ETL steps live
 * one-per-module under `./steps`; this file only wires them in order.
 *
 * The re-exports below preserve the pre-split import surface: tests and the
 * query tool import the constant/error/type from this exact module path.
 */
export { KNOWLEDGE_INDEX_NAME } from '../config';
export { VectorDimensionMismatchError } from '../errors';
export type { IndexKnowledgeDeps } from './schemas';

/**
 * Factory (test seam per spec 03 §3.6): composes read → chunk → embed → store,
 * injecting deps into the embed/store stages.
 */
export function createIndexKnowledgeWorkflow(deps: IndexKnowledgeDeps = {}) {
  return createWorkflow({
    id: 'index-knowledge',
    inputSchema: workflowInputSchema,
    outputSchema: workflowOutputSchema,
    description:
      'Index a document (path or inline) into the knowledge vector index: read → chunk → embed → store.',
  })
    .then(createReadDocumentStep())
    .then(createChunkDocumentStep())
    .then(createEmbedChunksStep(deps))
    .then(createStoreChunksStep(deps))
    .commit();
}

/** Production workflow: config-resolved embedder + registry-resolved vector store. */
export const indexKnowledgeWorkflow = createIndexKnowledgeWorkflow();

/** Guard used by the composition root: workflow is only useful with an embedder. */
export const knowledgeIndexingAvailable = (): boolean => semanticRecallAvailable();
