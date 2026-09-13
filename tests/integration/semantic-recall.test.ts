import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import type { MastraEmbeddingModel } from '@mastra/core/vector';

import { buildDomainMemory, RECALL_OPTIONS } from '../../src/mastra/shared/config/vectors';
import { resolveEmbedder } from '../../src/mastra/shared/config/model';
import { createHashingEmbedder } from '../helpers/deterministic-embedder';

/**
 * Scenario 3 — cross-thread semantic recall, ZERO provider keys, LibSQL
 * :memory:. Runs on the REAL fastembed E5 when the model cache is warm
 * (~/.cache/mastra/fastembed-models, G4 pre-warm) and otherwise on the
 * deterministic hashing stub so the tier stays green offline — same
 * keyless-observable retrieval contract either way.
 */

const FASTEMBED_MODEL = path.join(
  os.homedir(),
  '.cache',
  'mastra',
  'fastembed-models',
  'fast-multilingual-e5-large',
  'model.onnx'
);
// Warm = the actual model file is present; the cache DIRECTORY existing with a
// partial download is exactly the cold-cache case (root AGENTS.md gotcha #13).
const embedderWarm = existsSync(FASTEMBED_MODEL);

const msg = (id: string, text: string) => ({
  id,
  role: 'user' as const,
  content: { format: 2, parts: [{ type: 'text' as const, text }] },
  threadId: 'thread-1',
  resourceId: 'user-a',
});

async function runRecall(embedder: MastraEmbeddingModel<string>) {
  const vector = new LibSQLVector({ id: 'recall-it-vector', url: 'file::memory:' });
  const memory = await buildDomainMemory(
    { generateTitle: true },
    {
      embedder,
      vector,
    }
  )({ requestContext: {} as never });
  memory.setStorage(new LibSQLStore({ id: 'recall-it-storage', url: 'file::memory:' }));

  await memory.createThread({ threadId: 'thread-1', resourceId: 'user-a' });
  await memory.createThread({ threadId: 'thread-2', resourceId: 'user-a' });

  await memory.saveMessages({
    messages: [
      msg('fact', 'the staging DB password rotation is Fridays'),
      ...Array.from({ length: 45 }, (_, i) =>
        msg(
          `filler-${i}`,
          `filler update ${i}: the team retro highlighted ${i} wins, blockers and experiment notes`
        )
      ),
      // loose on purpose: MessageList normalizes at the boundary
    ] as never,
  });

  const result = await memory.recall({
    threadId: 'thread-2',
    resourceId: 'user-a',
    threadConfig: { semanticRecall: RECALL_OPTIONS },
    vectorSearchString: 'when do we rotate the staging password?',
  } as never);

  return { result, vector };
}

describe('Scenario 3 — cross-thread semantic recall (keyless)', () => {
  // The DB round-trip normalizes message content (vNext envelope), so the
  // fact is identified by its stable id + originating thread — proving the
  // vector hit crossed threads within the same resource (scope:resource).
  const factRecalled = (result: { messages: Array<{ id?: string; threadId?: string }> }) =>
    result.messages.some(m => m.id === 'fact' && m.threadId === 'thread-1');

  it('offline deterministic embedder: fact embedded 45+ messages earlier in thread-1 is recalled from thread-2', async () => {
    const stub = createHashingEmbedder(1024);
    const { result, vector } = await runRecall(stub.model);

    expect(stub.calls).toBeGreaterThan(0); // the seam did the embedding
    const indexes = await vector.listIndexes();
    expect(indexes).toContain('memory_messages_1024'); // derived from probed dim (G3)
    expect(factRecalled(result)).toBe(true);
  });

  it.skipIf(!embedderWarm)(
    'real fastembed multilingual-E5 (warm cache): paraphrased question retrieves the fact across threads',
    async () => {
      const r = resolveEmbedder();
      expect(r.source).toBe('fastembed');
      const { result } = await runRecall(r.passage!);
      expect(factRecalled(result)).toBe(true);
    }
  );
});
