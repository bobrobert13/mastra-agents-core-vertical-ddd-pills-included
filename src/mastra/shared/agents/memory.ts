// Mastra Memory: https://mastra.ai/docs/memory/overview
import { Memory } from '@mastra/memory';
import { RECALL_OPTIONS, resolveVectors } from '../config/vectors';

export function buildMemory(): Memory {
  const { store, embedder } = resolveVectors();
  const recall = Boolean(store && embedder);
  return new Memory({
    ...(recall ? { vector: store, embedder } : {}),
    options: {
      lastMessages: 10,
      semanticRecall: recall ? RECALL_OPTIONS : false,
      generateTitle: false,
    },
  });
}
