/**
 * Tier A gate runner (spec 07 §3.3 — the keyless blocking CI contract).
 *
 * `runEvals` cannot serve the keyless tier: its `target` must be a live
 * `Agent | Workflow`, and keyless CI cannot execute agents. So Tier A
 * re-scores RECORDED OUTPUT fixtures with deterministic, model-free scorers
 * (`keyword-coverage`, `completeness-scorer`, `tone-scorer`, the wrapped
 * `research-relevance` heuristic — all verified zero-LLM in §3.2) by calling
 * `scorer.run()` directly per fixture item, then:
 *
 *   1. every entry threshold must pass (number = minimum; `{min?,max?}` range
 *      — same semantics as `runEvals` thresholds), AND
 *   2. no tracked mean may drop > MAX_BASELINE_DELTA (0.02) vs the committed
 *      `tests/evals/baseline/eval-baseline.json`.
 *
 * Any miss produces verdict `'failed'`/`'scored'` → `assertGateReport` throws
 * `EVAL GATE <verdict>` → the vitest process exits nonzero → the `test-evals`
 * job goes red (D4: every gate blocks).
 *
 * NODE-STRIP-TYPES CONSTRAINT (like seed.ts): package + node builtin imports
 * only; local imports must carry explicit extensions.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createTestMessage } from '@mastra/evals/scorers/utils';
import type { MastraScorer, ScorerRunResult } from '@mastra/core/evals';

import {
  checkBaselineRegression,
  formatBaselineViolations,
  loadBaseline,
  type EvalBaseline,
} from './baseline-check.ts';

export type ThresholdConfig = number | { min?: number; max?: number };

export interface GateFixtureItem {
  /** Mirrors the dataset externalId (research-001…). */
  itemId: string;
  input: { query: string };
  output: {
    text: string;
    /** Recorded tool invocations → checks.* gates can replay them offline. */
    toolInvocations?: Array<{
      toolName: string;
      args?: Record<string, unknown>;
      result?: Record<string, unknown>;
      state?: 'call' | 'partial-call' | 'result';
    }>;
  };
}

export interface GateFixtures {
  agentId: string;
  recordedAt?: string;
  source?: string;
  items: GateFixtureItem[];
}

export interface GateScorerEntry {
  scorer: MastraScorer;
  /** Same semantics as runEvals: number ⇒ minimum; {min,max} ⇒ bounds. */
  threshold?: ThresholdConfig;
}

export interface PerItemScore {
  itemId: string;
  scorerKey: string;
  score: number;
  reason?: string;
}

export type GateVerdict = 'passed' | 'scored' | 'failed';

export interface GateReport {
  agentId: string;
  verdict: GateVerdict;
  /** `${scorerKey}` → mean across items. */
  means: Record<string, number>;
  perItem: PerItemScore[];
  errors: string[];
  thresholdMisses: string[];
  baselineViolations: ReturnType<typeof checkBaselineRegression>;
}

/** Threshold semantics verified against installed evals/thresholds.d.ts. */
export function checkThreshold(score: number, threshold: ThresholdConfig): boolean {
  if (typeof threshold === 'number') return score >= threshold;
  if (threshold.min !== undefined && score < threshold.min) return false;
  if (threshold.max !== undefined && score > threshold.max) return false;
  return true;
}

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');

/** Load `tests/evals/fixtures/<file>.json` (recorded outputs). */
export function loadGateFixtures(file: string): GateFixtures {
  const p = path.join(REPO_ROOT, 'tests', 'evals', 'fixtures', file);
  if (!existsSync(p)) throw new Error(`EVAL FIXTURE MISSING at ${p} — Tier A gates run on recorded fixtures`);
  const parsed = JSON.parse(readFileSync(p, 'utf8')) as GateFixtures;
  if (!parsed.agentId || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error(`EVAL FIXTURE ${p} has an unsupported shape (need agentId + non-empty items[])`);
  }
  return parsed;
}

/** Recorded item → the agent-run scorer shape (input/output as MastraDBMessages). */
export function fixtureItemToScorerRun(item: GateFixtureItem) {
  const inputMessages = [createTestMessage({ content: item.input.query, role: 'user' })];
  const outputMessage = createTestMessage({
    content: item.output.text,
    role: 'assistant',
    toolInvocations: (item.output.toolInvocations ?? []).map((t, i) => ({
      toolCallId: `recorded-${item.itemId}-${i}`,
      toolName: t.toolName,
      args: t.args ?? {},
      result: t.result ?? {},
      state: t.state ?? ('result' as const),
    })),
  });
  return {
    input: { inputMessages },
    output: [outputMessage],
    groundTruth: (item as { groundTruth?: unknown }).groundTruth,
  };
}

/**
 * Run every gate entry over every recorded fixture item; aggregate means;
 * evaluate thresholds + Δ-vs-baseline. NEVER throws — inspect the report or
 * call `assertGateReport`.
 *
 * Threshold keys use the scorer's own id; baseline keys are
 * `${agentId}::${scorerId}` (the EvalBaseline convention).
 */
export async function runFixtureGate(opts: {
  fixtures: GateFixtures;
  entries: GateScorerEntry[];
  baseline?: EvalBaseline | null;
  baselinePath?: string;
}): Promise<GateReport> {
  const { fixtures, entries } = opts;
  const baseline =
    opts.baseline === undefined && opts.baselinePath === undefined
      ? loadBaseline()
      : opts.baseline ?? (opts.baselinePath ? loadBaseline(opts.baselinePath) : null);

  const perItem: PerItemScore[] = [];
  const errors: string[] = [];

  for (const entry of entries) {
    const key = entry.scorer.id;
    for (const item of fixtures.items) {
      try {
        const run = fixtureItemToScorerRun(item);
        const result: ScorerRunResult = await entry.scorer.run(run);
        const score = typeof result.score === 'number' ? result.score : Number(result.score);
        if (!Number.isFinite(score)) {
          errors.push(`${key}/${item.itemId}: non-finite score (${String(result.score)})`);
          continue;
        }
        perItem.push({ itemId: item.itemId, scorerKey: key, score, reason: result.reason });
      } catch (error) {
        errors.push(`${key}/${item.itemId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const means: Record<string, number> = {};
  for (const entry of entries) {
    const key = entry.scorer.id;
    const scores = perItem.filter(p => p.scorerKey === key).map(p => p.score);
    if (scores.length > 0) means[key] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  const thresholdMisses: string[] = [];
  for (const entry of entries) {
    if (entry.threshold === undefined) continue;
    const mean = means[entry.scorer.id];
    if (mean === undefined) {
      thresholdMisses.push(`${entry.scorer.id}: no score produced`);
      continue;
    }
    if (!checkThreshold(mean, entry.threshold)) {
      thresholdMisses.push(
        `${entry.scorer.id}: average ${mean.toFixed(4)} violates threshold ${JSON.stringify(entry.threshold)}`
      );
    }
  }

  const observedBaselineKeys: Record<string, number> = {};
  for (const [key, value] of Object.entries(means)) {
    observedBaselineKeys[`${fixtures.agentId}::${key}`] = value;
  }
  const baselineViolations = baseline
    ? checkBaselineRegression(observedBaselineKeys, baseline)
    : [];

  let verdict: GateVerdict = 'passed';
  if (errors.length > 0 || baselineViolations.length > 0) verdict = 'failed';
  else if (thresholdMisses.length > 0) verdict = 'scored'; // threshold miss = red per D4

  return { agentId: fixtures.agentId, verdict, means, perItem, errors, thresholdMisses, baselineViolations };
}

/** D4 contract: `'scored'` (threshold miss) is red too, never advisory. */
export function assertGateReport(report: GateReport): void {
  if (report.verdict === 'passed') return;
  const parts = [
    ...report.errors.map(e => `error: ${e}`),
    ...report.thresholdMisses.map(t => `threshold: ${t}`),
    ...report.baselineViolations.map(v => `baseline Δ: ${formatBaselineViolations([v])}`),
  ];
  throw new Error(`EVAL GATE ${report.verdict} [${report.agentId}] — ${parts.join(' | ') || 'no detail'}`);
}

/**
 * Live-tier verdict guard (scenario 1): runEvals `verdict` must be exactly
 * `'passed'` — `'scored'` counts as red per D4. Used inside the
 * skipIf(hasProviderKey) describes only.
 */
export function assertLiveVerdict(verdict: GateVerdict | undefined, detail?: string): void {
  if (verdict !== 'passed') {
    throw new Error(`EVAL GATE ${verdict ?? 'missing'}${detail ? ` — ${detail}` : ''}`);
  }
}
