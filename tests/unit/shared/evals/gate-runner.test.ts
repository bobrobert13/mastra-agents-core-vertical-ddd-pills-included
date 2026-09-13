import { describe, expect, it } from 'vitest';

import {
  checkThreshold,
  assertGateReport,
  assertLiveVerdict,
  fixtureItemToScorerRun,
  loadGateFixtures,
  runFixtureGate,
  type GateFixtures,
} from '../../../../src/mastra/shared/evals/gate-runner';
import { createKeywordCoverageScorer } from '@mastra/evals/scorers/prebuilt';

/**
 * Unit coverage for the Tier A gate machinery (spec 07 §3.3) — the exact
 * helpers the blocking suites use. All offline, all deterministic.
 */
describe('gate-runner — thresholds (verified runEvals semantics)', () => {
  it('number = minimum', () => {
    expect(checkThreshold(0.5, 0.5)).toBe(true);
    expect(checkThreshold(0.499, 0.5)).toBe(false);
    expect(checkThreshold(1, 0.5)).toBe(true);
  });

  it('{min?,max?} = bounds; max is the form for "high is bad" scorers', () => {
    expect(checkThreshold(0.45, { min: 0.45 })).toBe(true);
    expect(checkThreshold(0.44, { min: 0.45 })).toBe(false);
    expect(checkThreshold(0.3, { max: 0.3 })).toBe(true);
    expect(checkThreshold(0.31, { max: 0.3 })).toBe(false);
    expect(checkThreshold(0.5, { min: 0.2, max: 0.8 })).toBe(true);
    expect(checkThreshold(0.9, { min: 0.2, max: 0.8 })).toBe(false);
  });
});

describe('gate-runner — fixture run shape', () => {
  it('converts a recorded item into the agent-run scorer format', () => {
    const run = fixtureItemToScorerRun({
      itemId: 'x-1',
      input: { query: 'What is the capital of France?' },
      output: {
        text: 'Paris.',
        toolInvocations: [{ toolName: 'web_search', args: { q: 'x' }, result: { n: 1 }, state: 'result' }],
      },
    });
    expect(run.input.inputMessages).toHaveLength(1);
    expect(Array.isArray(run.output)).toBe(true);
    // installed createTestMessage keeps tool traces on content.toolInvocations
    // (legacy field the checks.* scorers read first — verified)
    const content = (run.output[0] as { content: Record<string, unknown> }).content;
    expect(content.toolInvocations).toMatchObject([{ toolName: 'web_search' }]);
  });
});

describe('gate-runner — verdict aggregation', () => {
  const fixtures: GateFixtures = {
    agentId: 'unit-agent',
    items: [
      {
        itemId: 'u-1',
        // answer covers only capital+population, omits area+mayor → ~0.6
        input: { query: 'What is the capital of France, its population, area and mayor?' },
        output: { text: 'The capital of France is Paris, with a population of 2.1 million people.' },
      },
    ],
  };

  it('passes with a lenient threshold + no baseline; EVAL GATE is never thrown', async () => {
    const report = await runFixtureGate({
      fixtures,
      entries: [{ scorer: createKeywordCoverageScorer(), threshold: 0.5 }],
      baseline: null,
    });
    expect(report.verdict).toBe('passed');
    expect(report.means['keyword-coverage-scorer']).toBeGreaterThan(0.5);
    expect(() => assertGateReport(report)).not.toThrow();
  });

  it('threshold miss → verdict `scored` → assertGateReport throws EVAL GATE (D4: red)', async () => {
    const report = await runFixtureGate({
      fixtures,
      entries: [{ scorer: createKeywordCoverageScorer(), threshold: 0.9 }],
      baseline: null,
    });
    expect(report.verdict).toBe('scored');
    expect(report.thresholdMisses[0]).toMatch(/violates threshold/);
    expect(() => assertGateReport(report)).toThrow(/^EVAL GATE scored/);
  });

  it('baseline regression > 0.02 → verdict `failed` with the offending key', async () => {
    const report = await runFixtureGate({
      fixtures,
      entries: [{ scorer: createKeywordCoverageScorer() }],
      baseline: {
        schemaVersion: 1,
        generatedAt: 'x',
        source: 'unit',
        means: { 'unit-agent::keyword-coverage-scorer': 0.9 },
      },
    });
    expect(report.verdict).toBe('failed');
    expect(report.baselineViolations[0]?.key).toBe('unit-agent::keyword-coverage-scorer');
    expect(() => assertGateReport(report)).toThrow(/^EVAL GATE failed/);
  });

  it('assertLiveVerdict: only exactly `passed` is green — missing/scored/failed all red', () => {
    expect(() => assertLiveVerdict('passed')).not.toThrow();
    expect(() => assertLiveVerdict('scored')).toThrow(/^EVAL GATE scored/);
    expect(() => assertLiveVerdict('failed')).toThrow(/^EVAL GATE failed/);
    expect(() => assertLiveVerdict(undefined)).toThrow(/^EVAL GATE missing/);
  });

  it('loadGateFixtures fails loudly when a fixture file is missing', () => {
    expect(() => loadGateFixtures('does-not-exist-recorded.json')).toThrow(/EVAL FIXTURE MISSING/);
  });
});
