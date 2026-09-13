import type { MastraEmbeddingModel } from '@mastra/core/vector';

/**
 * Offline deterministic test embedders (spec 03 §3.6 test seams).
 * HashingEmbedder: bag-of-words hashed into a fixed dimension + L2-normalized
 * — shared tokens ⇒ high cosine similarity, so semantic recall/RAG behavior
 * is observable with zero network and zero keys.
 */

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}€]+/u)
    .filter(Boolean);
}

export interface CountingEmbedder {
  model: MastraEmbeddingModel<string>;
  /** batches (values arrays) passed to doEmbed */
  batches: string[][];
  get calls(): number;
  get embeddedValues(): string[];
}

export function createHashingEmbedder(dimension = 1024): CountingEmbedder {
  const batches: string[][] = [];
  const embedOne = (text: string): number[] => {
    const v = new Array<number>(dimension).fill(0);
    for (const token of normalize(text)) v[hashToken(token) % dimension] += 1;
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map(x => x / norm);
  };

  const model = {
    specificationVersion: 'v2',
    provider: 'stub-hashing',
    modelId: `stub/hashing-${dimension}`,
    maxEmbeddingsPerCall: 256,
    supportsParallelCalls: false,
    doEmbed: async ({ values }: { values: string[] }) => {
      batches.push(values);
      return {
        embeddings: values.map(embedOne),
        usage: { totalTokens: values.reduce((s, x) => s + x.length, 0) },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as MastraEmbeddingModel<string>;

  return {
    model,
    batches,
    get calls() {
      return batches.length;
    },
    get embeddedValues() {
      return batches.flat();
    },
  };
}

/** Fixed-dimension embedder for the Scenario 6 sticky-dimension hazard. */
export function createFixedDimEmbedder(dimension: number): MastraEmbeddingModel<string> {
  return {
    specificationVersion: 'v2',
    provider: 'stub-fixed',
    modelId: `stub/fixed-${dimension}`,
    maxEmbeddingsPerCall: 256,
    supportsParallelCalls: false,
    doEmbed: async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => new Array<number>(dimension).fill(1 / Math.sqrt(dimension))),
      usage: { totalTokens: 0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }),
  } as unknown as MastraEmbeddingModel<string>;
}

/** Embedder that always fails at first use — Scenario 4c (cold-cache offline). */
export function createThrowingEmbedder(): CountingEmbedder {
  const batches: string[][] = [];
  const model = {
    specificationVersion: 'v2',
    provider: 'stub-throwing',
    modelId: 'stub/throwing',
    maxEmbeddingsPerCall: 256,
    supportsParallelCalls: false,
    doEmbed: async ({ values }: { values: string[] }) => {
      batches.push(values);
      throw new Error('offline: model download from storage.googleapis.com failed');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as MastraEmbeddingModel<string>;

  return {
    model,
    batches,
    get calls() {
      return batches.length;
    },
    get embeddedValues() {
      return batches.flat();
    },
  };
}
