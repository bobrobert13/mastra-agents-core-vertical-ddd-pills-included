import { describe, expect, it } from 'vitest';
import { checks } from '@mastra/evals/checks';
import { runEvals } from '@mastra/core/evals';
import { createKeywordCoverageScorer } from '@mastra/evals/scorers/prebuilt';
import { expectEvals } from '@mastra/evals/vitest';

import { researchAgent } from '../../../src/mastra/domains/research';
import {
  assertGateReport,
  assertLiveVerdict,
  loadGateFixtures,
  runFixtureGate,
} from '../../../src/mastra/shared/evals/gate-runner';
import { hasProviderKey, offlineEntriesFor } from './_helpers';

/**
 * Tier A research gate (spec 07 scenarios 1 + 5). Keyless-blocking tier:
 * deterministic scorers replay the RECORDED outputs, thresholds + the
 * ≤ 0.02 Δ against tests/evals/baseline/eval-baseline.json must hold.
 * The live `runEvals` twin runs ONLY when a provider key exists
 * (same-repo PRs) — a keyless fork never executes the agent.
 */
describe('Tier A eval gate — research-agent (keyless, blocking)', () => {
  it('recorded fixtures clear every offline threshold and hold the baseline Δ → EVAL GATE passes', async () => {
    const fixtures = loadGateFixtures('research-recorded.json');
    expect(fixtures.agentId).toBe('research-agent');
    expect(fixtures.items.length).toBeGreaterThanOrEqual(10);

    const report = await runFixtureGate({ fixtures, entries: offlineEntriesFor('research-agent') });
    // assertGateReport throws `EVAL GATE <verdict>` → nonzero exit → red job (D4)
    expect(() => assertGateReport(report)).not.toThrow();
    expect(report.verdict).toBe('passed');
  });

  it('demonstrably goes RED on a hand-perturbed fixture (DoD: gate honesty)', async () => {
    const fixtures = structuredClone(loadGateFixtures('research-recorded.json'));
    // Simulate a quality regression: every answer collapses to filler.
    for (const item of fixtures.items) {
      item.output = { text: 'Sorry, I cannot help with that.' };
    }

    const report = await runFixtureGate({ fixtures, entries: offlineEntriesFor('research-agent') });
    expect(['scored', 'failed']).toContain(report.verdict);
    expect(() => assertGateReport(report)).toThrow(/^EVAL GATE /);
  });
});

describe.skipIf(!hasProviderKey())(
  'Tier A live twin — runEvals gates vs the REAL agent (same-repo PRs only)',
  () => {
    it('verdict must be exactly `passed` — `scored` is red per D4', async () => {
      const fixtures = loadGateFixtures('research-recorded.json');
      const result = await runEvals({
        data: fixtures.items.slice(0, 3).map(i => ({ input: i.input.query })),
        target: researchAgent,
        gates: [checks.calledTool('web_search'), checks.noToolErrors()],
        scorers: [
          { scorer: createKeywordCoverageScorer(), threshold: 0.5 }, // number = minimum (verified)
        ],
      });
      assertLiveVerdict(result.verdict);
    }, 120_000);

    it('@mastra/evals/vitest: expectEvals(...).toPass() enforces per-gate pass rate natively', async () => {
      const fixtures = loadGateFixtures('research-recorded.json');
      const result = await expectEvals({
        data: fixtures.items.slice(0, 2).map(i => ({ input: i.input.query })),
        target: researchAgent,
        gates: [checks.noToolErrors()],
      }).toPass(1); // every item must pass every gate
      expect(result.verdict).toBe('passed');
    }, 120_000);
  }
);
