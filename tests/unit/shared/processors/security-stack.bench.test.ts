/**
 * Spec 06 NFR-1 timing artifact (PROPOSAL: < 10 ms p95 per deterministic
 * processor). N ≥ 1000 synthetic runs of the assembled DETERMINISTIC chain
 * (TokenLimiter prune + workspace jail + shared cache probe), with/without
 * delta. NON-CI by design (same convention as spec 02's benchmark): runs only
 * with RUN_BENCH=1, locally / pre-merge; the numbers gate the review of the
 * 10 ms threshold, not the pipeline.
 *
 *   RUN_BENCH=1 npx vitest run tests/unit/shared/processors/security-stack.bench.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildSecurityStack } from '../../../../src/mastra/shared/processors/security-stack';
import { resolveWorkspacePath } from '../../../../src/mastra/shared/tools/workspace-path';
import { InMemoryServerCache } from '@mastra/core/cache';
import type { DomainScope } from '../../../../src/mastra/shared/processors/scope-guard';

const RUN = process.env.RUN_BENCH === '1';
const N = 1000;

const scope: DomainScope = {
  domain: 'bench',
  agentName: 'Bench Agent',
  scope: 'benchmark',
  outOfScopeExamples: [],
  siblings: [],
};

function stubMessageList(text: string) {
  const messages = [
    { id: 'u1', role: 'user', content: { format: 'content-v2', parts: [{ type: 'text', text }] } },
  ];
  return {
    messages,
    get: { all: { db: () => messages } },
    getAllSystemMessages: () => [{ role: 'system' as const, content: 'tiny system' }],
    removeByIds: (ids: string[]) => {
      const drop = new Set(ids);
      for (let i = messages.length - 1; i >= 0; i--)
        if (drop.has(messages[i].id)) messages.splice(i, 1);
    },
  };
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

describe.skipIf(!RUN)('security-stack deterministic-chain timing (N=1000, non-CI artifact)', () => {
  it('with-stack minus baseline stays under the proposed 10 ms p95 budget', async () => {
    delete process.env.SECURITY_PROCESSORS;
    delete process.env.OPENAI_API_KEY;
    const stack = buildSecurityStack({ scope }); // zero-config: guard(inert) + TokenLimiter + ResponseCache
    const limiter = stack.inputProcessors.find(p => p.id === 'token-limiter') as {
      processInputStep(args: never): Promise<void>;
    };
    const cache = new InMemoryServerCache();

    const baseline: number[] = [];
    const withStack: number[] = [];

    for (let i = 0; i < N; i++) {
      const payload = `synthetic request ${i} ${'lorem ipsum dolor sit amet '.repeat(20)}`;

      let t0 = performance.now();
      await Promise.resolve(payload); // no-op baseline of the same async shape
      baseline.push(performance.now() - t0);

      t0 = performance.now();
      await limiter.processInputStep({ messageList: stubMessageList(payload) } as never);
      resolveWorkspacePath(`bench/nested-${i % 10}/note.md`);
      await cache.get(`missing-key-${i % 50}`); // cache miss probe (the hit path is a get)
      withStack.push(performance.now() - t0);
    }

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const deltaP95 = p95(withStack) - p95(baseline);
    // eslint-disable-next-line no-console -- bench artifact output, non-CI tier
    console.info(
      `[security-stack.bench] N=${N} | chain mean ${mean(withStack).toFixed(4)}ms p95 ${p95(withStack).toFixed(4)}ms | baseline p95 ${p95(baseline).toFixed(4)}ms | DELTA p95 ${deltaP95.toFixed(4)}ms (budget: 10ms, PROPOSAL pending review)`
    );

    expect(deltaP95).toBeLessThan(10);
  });
});
