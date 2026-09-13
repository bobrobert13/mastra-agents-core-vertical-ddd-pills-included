import { describe, expect, it } from 'vitest';

import {
  assertGateReport,
  loadGateFixtures,
  runFixtureGate,
} from '../../../src/mastra/shared/evals/gate-runner';
import { offlineEntriesFor } from './_helpers';

/**
 * Tier A communication gate (spec 07 §3.2): the code-based `tone-scorer`
 * (sentiment-difference, zero-LLM) + keyword-coverage run on recorded
 * fixtures; the `bias` judge (max 0.3) is Tier B only. Tone regressions —
 * the comms agent's main quality axis — are therefore keyless-blocking.
 */
describe('Tier A eval gate — communication-agent (keyless, blocking)', () => {
  it('recorded fixtures clear thresholds and hold the baseline Δ → EVAL GATE passes', async () => {
    const fixtures = loadGateFixtures('communication-recorded.json');

    const report = await runFixtureGate({
      fixtures,
      entries: offlineEntriesFor('communication-agent'),
    });
    expect(() => assertGateReport(report)).not.toThrow();
    expect(report.verdict).toBe('passed');
  });

  it('demonstrably goes RED when recorded replies collapse (tone + coverage crash)', async () => {
    const fixtures = structuredClone(loadGateFixtures('communication-recorded.json'));
    for (const item of fixtures.items) {
      item.output = { text: 'no.' };
    }
    const report = await runFixtureGate({
      fixtures,
      entries: offlineEntriesFor('communication-agent'),
    });
    expect(['scored', 'failed']).toContain(report.verdict);
    expect(() => assertGateReport(report)).toThrow(/^EVAL GATE /);
  });
});
