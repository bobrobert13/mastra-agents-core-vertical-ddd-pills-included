import type { MastraEmbeddingModel } from '@mastra/core/vector';

/** Offline, deterministic bag-of-words hashing embedder (L2-normalized). */
function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createHashingEmbedder(dimension = 1024): MastraEmbeddingModel<string> {
  const embedOne = (text: string): number[] => {
    const v = new Array<number>(dimension).fill(0);
    const tokens = text
      .toLowerCase()
      .split(/[^\p{L}\p{N}€]+/u)
      .filter(Boolean);
    for (const token of tokens) v[hashToken(token) % dimension] += 1;
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1;
    return v.map(x => x / norm);
  };

  return {
    specificationVersion: 'v2',
    provider: 'stub-hashing',
    modelId: `stub/hashing-${dimension}`,
    maxEmbeddingsPerCall: 256,
    supportsParallelCalls: false,
    doEmbed: async ({ values }: { values: string[] }) => ({
      embeddings: values.map(embedOne),
      usage: { totalTokens: values.reduce((sum, value) => sum + value.length, 0) },
    }),
  } as unknown as MastraEmbeddingModel<string>;
}
