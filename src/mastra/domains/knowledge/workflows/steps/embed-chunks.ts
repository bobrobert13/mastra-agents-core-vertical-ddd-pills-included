import { createStep } from '@mastra/core/workflows';

import { resolveEmbedder } from '../../../../shared/config/model';
import { markEmbedderUnavailable } from '../../../../shared/config/vectors';
import { eventBus, makeEvent } from '../../../../shared/events';
import { EMBED_BATCH } from '../../config';
import { knowledgeIndexFailedEvent } from '../../events';
import { chunkedDocSchema, embeddedDocSchema, type IndexKnowledgeDeps } from '../schemas';

/**
 * `embed-chunks` — batched `doEmbed` over the resolved passage model (or the
 * injected stub). A runtime failure latches the module health flag + publishes
 * `knowledge.index-failed`, then rethrows so the step (not the process) fails.
 */
export function createEmbedChunksStep(deps: IndexKnowledgeDeps) {
  return createStep({
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
}
