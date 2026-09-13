import { describe, expect, it } from 'vitest';

import {
  assertGateReport,
  loadGateFixtures,
  runFixtureGate,
} from '../../../src/mastra/shared/evals/gate-runner';
import { offlineEntriesFor } from './_helpers';

/**
 * Tier A file-operations gate (spec 07 §3.2): keyword-coverage offline;
 * `hallucination` (LLM, gate `max: 0.2` — the gotcha #7 incident agent) and
 * the didNotCall/toolOrder gates need a live run → Tier B / skipIf blocks.
 * The recorded fixtures keep a real tool trace per item so hallucinated
 * tool-call regressions remain inspectable in review.
 */
describe('Tier A eval gate — file-operations-agent (keyless, blocking)', () => {
  it('recorded fixtures clear thresholds and hold the baseline Δ → EVAL GATE passes', async () => {
    const fixtures = loadGateFixtures('file-operations-recorded.json');

    const report = await runFixtureGate({
      fixtures,
      entries: offlineEntriesFor('file-operations-agent'),
    });
    expect(() => assertGateReport(report)).not.toThrow();
    expect(report.verdict).toBe('passed');
  });

  it('demonstrably goes RED when recorded file answers collapse to filler', async () => {
    const fixtures = structuredClone(loadGateFixtures('file-operations-recorded.json'));
    for (const item of fixtures.items) {
      item.output = { text: 'Done.' };
    }
    const report = await runFixtureGate({
      fixtures,
      entries: offlineEntriesFor('file-operations-agent'),
    });
    expect(['scored', 'failed']).toContain(report.verdict);
    expect(() => assertGateReport(report)).toThrow(/^EVAL GATE /);
  });
});
