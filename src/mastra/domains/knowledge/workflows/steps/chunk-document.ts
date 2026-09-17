import { MDocument } from '@mastra/rag';
import { createStep } from '@mastra/core/workflows';

import { CHUNK_MAX_SIZE, CHUNK_OVERLAP } from '../../config';
import { chunkedDocSchema, readDocSchema } from '../schemas';

/**
 * `chunk-document` — recursive chunking (512/50) with deterministic
 * `<docId>:<index>` ids; empty/whitespace chunks are dropped.
 */
export function createChunkDocumentStep() {
  return createStep({
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
        .filter(c => c.text.trim().length > 0);

      return { docId: inputData.docId, source: inputData.source, chunks };
    },
  });
}
