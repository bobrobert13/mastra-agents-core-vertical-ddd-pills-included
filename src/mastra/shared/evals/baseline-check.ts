/**
 * Committed eval baseline + regression check (spec 07 §3.3 Tier A, scenario 5).
 *
 * `tests/evals/baseline/eval-baseline.json` holds the tracked per-scorer MEAN
 * scores from the last live-tier recording (refreshed by evals-live.yml on
 * `main`). The keyless gate re-computes means over the RECORDED fixtures and
 * fails when any tracked mean DROPS more than `MAX_BASELINE_DELTA` (0.02).
 * Improvements never fail — the nightly refresh absorbs them.
 *
 * A keyless run cannot score the LIVE agent (runEvals needs an Agent target),
 * hence the fixtures-vs-baseline mechanism instead of experiment Δ — the
 * Δ-vs-live-experiment comparison lives in Tier B (compareExperiments).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Any tracked mean dropping more than this vs baseline = red (spec §3.3). */
export const MAX_BASELINE_DELTA = 0.02;

export interface EvalBaseline {
  schemaVersion: 1;
  generatedAt: string;
  /** Human traceability: which evals-live run produced these means. */
  source: string;
  /** Key: `${agentId}::${scorerId}` → mean score across fixture items. */
  means: Record<string, number>;
}

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');

export const BASELINE_PATH = path.join(REPO_ROOT, 'tests', 'evals', 'baseline', 'eval-baseline.json');

export function loadBaseline(filePath = BASELINE_PATH): EvalBaseline {
  if (!existsSync(filePath)) {
    throw new Error(
      `EVAL BASELINE MISSING at ${filePath} — regenerate via .github/workflows/evals-live.yml (Tier B) ` +
        `or commit an initial baseline; the Tier A gate refuses to run blind (D4).`
    );
  }
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as EvalBaseline;
  if (parsed.schemaVersion !== 1 || typeof parsed.means !== 'object' || parsed.means === null) {
    throw new Error(`EVAL BASELINE at ${filePath} has an unsupported shape (expected schemaVersion 1)`);
  }
  return parsed;
}

export function writeBaseline(baseline: EvalBaseline, filePath = BASELINE_PATH): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

export interface BaselineViolation {
  key: string;
  baselineMean: number;
  observedMean: number;
  delta: number;
}

/**
 * Compare observed means against the committed baseline. Only keys present in
 * BOTH sides are compared (a newly added scorer cannot regress against a
 * baseline that has never tracked it; the nightly will start tracking it).
 */
export function checkBaselineRegression(
  observedMeans: Record<string, number>,
  baseline: EvalBaseline,
  maxDelta: number = MAX_BASELINE_DELTA
): BaselineViolation[] {
  const violations: BaselineViolation[] = [];
  for (const [key, baselineMean] of Object.entries(baseline.means)) {
    const observed = observedMeans[key];
    if (typeof observed !== 'number') continue;
    const delta = baselineMean - observed; // positive = regression
    // epsilon: 0.8 − 0.78 = 0.020000000000000018 in IEEE-754 would false-red
    // the exact tolerance boundary.
    if (delta > maxDelta + 1e-9) {
      violations.push({ key, baselineMean, observedMean: observed, delta });
    }
  }
  return violations;
}

/** Human-readable failure line(s) for a regression list. */
export function formatBaselineViolations(violations: BaselineViolation[]): string {
  return violations
    .map(
      v =>
        `${v.key}: mean ${v.observedMean.toFixed(4)} vs baseline ${v.baselineMean.toFixed(4)} ` +
        `(Δ ${v.delta.toFixed(4)} > ${MAX_BASELINE_DELTA})`
    )
    .join('; ');
}
