import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';

import { createThrowingEmbedder } from '../helpers/deterministic-embedder';

/**
 * Scenario 4c — late runtime failure (offline cold cache) is LAZY and
 * LATCHED one-way: first embed attempt fails, the module flag flips, exactly
 * ONE canonical logger.warn line is emitted, and later requests built through
 * the §3.3 factory make ZERO further embed attempts.
 *
 * The live variant (storage.googleapis.com unreachable + cold cache) cannot
 * be synthesized deterministically in CI → skipIf-guarded behind an explicit
 * opt-in env flag, per the repo skipIf convention.
 */

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.SEMANTIC_RECALL;
  delete process.env.EMBEDDING_MODEL;
  vi.restoreAllMocks();
});

async function freshVectors() {
  vi.resetModules();
  const vectors = await import('../../src/mastra/shared/config/vectors');
  const { logger } = await import('../../src/mastra/shared/logger');
  return { ...vectors, logger };
}

function messages(count: number): never[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m-${i}`,
    role: 'user' as const,
    content: {
      format: 2,
      parts: [{ type: 'text' as const, text: `rememberable note number ${i}` }],
    },
    threadId: 'thread-a',
    resourceId: 'user-a',
  })) as never[];
}

describe('Scenario 4c — throwing embedder via the buildDomainMemory seam', () => {
  it('latches after the first failure: ONE warn, then zero further embed attempts', async () => {
    const v = await freshVectors();
    const warn = vi.spyOn(v.logger, 'warn').mockImplementation(() => {});

    // First "request": memory built while recall is believed available.
    const first = createThrowingEmbedder();
    const vector = new LibSQLVector({ id: 'degrade-v', url: 'file::memory:' });
    const memory = await v.buildDomainMemory(
      { generateTitle: true },
      {
        embedder: first.model,
        vector,
      }
    )({ requestContext: {} as never });
    memory.setStorage(new LibSQLStore({ id: 'degrade-s', url: 'file::memory:' }));
    await memory.createThread({ threadId: 'thread-a', resourceId: 'user-a' });

    // The embed attempts fail (storage save itself already happened for the
    // generate path; the guard's job is to latch + warn once).
    await memory.saveMessages({ messages: messages(2) }).catch(() => undefined);

    // One attempt per in-flight message (2 saved concurrently), then the
    // latch blocks every further attempt — no ai-sdk retry storm reaching
    // the embedder after the flag flips.
    expect(first.calls).toBeGreaterThanOrEqual(1);
    expect(first.calls).toBeLessThanOrEqual(2);
    const callsAfterFirst = first.calls;

    // Same memory, further saves: the guard short-circuits — zero NEW attempts.
    await memory.saveMessages({ messages: messages(3) }).catch(() => undefined);
    expect(first.calls).toBe(callsAfterFirst);
    const canonicalWarns = warn.mock.calls.filter(call =>
      String(call[0]).startsWith('Semantic recall: off (no embedder)')
    );
    expect(canonicalWarns).toHaveLength(1);
    expect(v.semanticRecallAvailable()).toBe(false);

    // Second "request": fresh factory build — recall OFF, history works.
    const second = createThrowingEmbedder();
    const memory2 = await v.buildDomainMemory(
      { generateTitle: true },
      {
        embedder: second.model,
        vector: new LibSQLVector({ id: 'degrade-v2', url: 'file::memory:' }),
      }
    )({ requestContext: {} as never });
    memory2.setStorage(new LibSQLStore({ id: 'degrade-s2', url: 'file::memory:' }));
    await memory2.createThread({ threadId: 'thread-a', resourceId: 'user-a' });
    await memory2.saveMessages({ messages: messages(3) });

    expect(second.calls).toBe(0); // no retry storm
    const list = await memory2.recall({ threadId: 'thread-a', resourceId: 'user-a' } as never);
    expect(list.messages.length).toBeGreaterThan(0);
    expect(
      warn.mock.calls.filter(c => String(c[0]).startsWith('Semantic recall: off (no embedder)'))
    ).toHaveLength(1);
  });

  const liveOffline =
    process.env.TEST_LIVE_OFFLINE_DEGRADE === 'true' &&
    // cold = model FILE absent (a directory with a partial download is still cold — gotcha #13)
    !existsSync(
      path.join(
        os.homedir(),
        '.cache',
        'mastra',
        'fastembed-models',
        'fast-multilingual-e5-large',
        'model.onnx'
      )
    );

  it.skipIf(!liveOffline)(
    'live: cold cache + unreachable storage.googleapis.com degrades the same way',
    async () => {
      const v = await freshVectors();
      const { resolveEmbedder } = await import('../../src/mastra/shared/config/model');
      const r = resolveEmbedder();
      const memory = await v.buildDomainMemory(
        { generateTitle: true },
        {}
      )({
        requestContext: {} as never,
      });
      memory.setStorage(new LibSQLStore({ id: 'live-s', url: 'file::memory:' }));
      await memory.createThread({ threadId: 'thread-a', resourceId: 'user-a' });
      await memory.saveMessages({ messages: messages(2) }); // must not crash
      expect(v.semanticRecallAvailable()).toBe(false);
      expect(r.source).toBe('fastembed'); // resolution was valid; failure is runtime
    },
    120_000
  );
});
