import { describe, expect, it } from 'vitest';

import {
  assertGateReport,
  loadGateFixtures,
  runFixtureGate,
} from '../../../src/mastra/shared/evals/gate-runner';
import { offlineEntriesFor } from './_helpers';

/**
 * Tier A task-management gate (spec 07 §3.2/§3.3): keyword-coverage +
 * completeness over recorded task outputs. `checks.calledTool('create_task')`
 * / `noToolErrors` are the live-run gates (skipped keyless — see the
 * Scenario 1 live twin for the pattern).
 */
describe('Tier A eval gate — task-management-agent (keyless, blocking)', () => {
  it('recorded fixtures clear thresholds and hold the baseline Δ → EVAL GATE passes', async () => {
    const fixtures = loadGateFixtures('task-recorded.json');
    expect(fixtures.items.length).toBeGreaterThanOrEqual(10);

    const report = await runFixtureGate({
      fixtures,
      entries: offlineEntriesFor('task-management-agent'),
    });
    expect(() => assertGateReport(report)).not.toThrow();
    expect(report.verdict).toBe('passed');
  });

  it('demonstrably goes RED when recorded task outputs collapse', async () => {
    const fixtures = structuredClone(loadGateFixtures('task-recorded.json'));
    for (const item of fixtures.items) {
      item.output = { text: 'I am not able to do that.' };
    }
    const report = await runFixtureGate({
      fixtures,
      entries: offlineEntriesFor('task-management-agent'),
    });
    expect(['scored', 'failed']).toContain(report.verdict);
    expect(() => assertGateReport(report)).toThrow(/^EVAL GATE /);
  });
});
