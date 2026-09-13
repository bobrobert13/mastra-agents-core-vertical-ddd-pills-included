import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Mastra } from '@mastra/core/mastra';
import type { ExperimentSummary, ItemWithScores } from '@mastra/core/datasets';

import { createEvalMastra } from '../eval-instance';
import { seedEvalDatasets } from '../../../src/mastra/shared/evals/seed';
import {
  BASELINE_PATH,
  writeBaseline,
  type EvalBaseline,
} from '../../../src/mastra/shared/evals/baseline-check';
import { hasProviderKey } from '../gates/_helpers';

/**
 * Tier B — LLM-judge experiments (spec 07 scenarios 4 + 5, §3.3):
 * ONLY executed by `.github/workflows/evals-live.yml` (schedule /
 * workflow_dispatch / push to main) when BOTH a provider secret AND
 * `EVALS_LIVE_MODE=1` are set. The agent's model is resolved at import time
 * from env (MODEL_RESEARCH override), so the workflow runs each phase in a
 * SEPARATE process:
 *
 *   phase=baseline  → startExperiment(baseline-main) on the pinned dataset
 *                     version; then refresh the committed fixtures +
 *                     eval-baseline.json from the recorded outputs (the
 *                     workflow opens the auto-PR — see `updateBaseline`)
 *   phase=candidate → MODEL_RESEARCH=<input> → startExperiment(pr-<run-id>)
 *                     pinned to the SAME dataset version
 *   phase=compare   → mastra.datasets.compareExperiments(...) →
 *                     $GITHUB_STEP_SUMMARY Δ table + JSON artifact
 *
 * Never a PR merge requirement → forks cannot false-red on it (Scenario 5).
 */

const PHASE = (process.env.EVALS_LIVE_PHASE ?? '').trim();
const STATE_DIR = path.resolve(process.cwd(), '.eval-live');
const STATE_FILE = path.join(STATE_DIR, 'experiments.json');
const FIXTURES_DIR = path.resolve(process.cwd(), 'tests', 'evals', 'fixtures');
const LIVE_MODE = process.env.EVALS_LIVE_MODE === '1' && hasProviderKey() && PHASE !== '';

interface LiveState {
  datasetId: string;
  datasetVersion: number;
  baselineExperimentId?: string;
  candidateExperimentId?: string;
  candidateModel?: string;
}

function readState(): LiveState {
  if (!existsSync(STATE_FILE)) {
    throw new Error(`Tier B state file missing: ${STATE_FILE} (baseline phase must run first)`);
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as LiveState;
}

function writeState(state: LiveState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function appendSummary(markdown: string): void {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (target) writeFileSync(target, markdown, { flag: 'a' });
}

/** Defensive text extraction — experiment row.output is typed `unknown`. */
function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    for (const k of ['text', 'output', 'result', 'content']) {
      if (typeof v[k] === 'string') return v[k] as string;
    }
    if (Array.isArray(v.parts)) {
      return (v.parts as Array<Record<string, unknown>>)
        .map(p => (typeof p.text === 'string' ? p.text : ''))
        .join(' ');
    }
  }
  return '';
}

/** Persist a baseline refresh from a completed experiment summary. */
function refreshArtifactsFromSummary(summary: ExperimentSummary, datasetVersion: number): void {
  const means: Record<string, number[]> = {};
  for (const row of summary.results as ItemWithScores[]) {
    for (const s of row.scores) {
      if (typeof s.score !== 'number') continue;
      (means[s.scorerId] ??= []).push(s.score);
    }
  }
  const tracked: Record<string, number> = {};
  for (const [scorerId, values] of Object.entries(means)) {
    tracked[`research-agent::${scorerId}`] = +(
      values.reduce((a, b) => a + b, 0) / values.length
    ).toFixed(6);
  }

  if (Object.keys(tracked).length > 0) {
    const baseline: EvalBaseline = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: `evals-live.yml baseline-main ${summary.experimentId} (dataset v${datasetVersion})`,
      means: tracked,
    };
    writeBaseline(baseline, BASELINE_PATH);
  }

  const items = summary.results
    .map(row => ({
      itemId: String(row.itemId),
      input: { query: extractText(row.input) },
      output: { text: extractText(row.output) },
    }))
    .filter(i => i.input.query && i.output.text);

  if (items.length > 0) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    writeFileSync(
      path.join(FIXTURES_DIR, 'research-recorded.json'),
      `${JSON.stringify(
        {
          agentId: 'research-agent',
          recordedAt: new Date().toISOString().slice(0, 10),
          source: `RECORDED by evals-live.yml baseline-main ${summary.experimentId} (spec 07 §3.3)`,
          items,
        },
        null,
        2
      )}\n`,
      'utf8'
    );
  }
}

describe.skipIf(!LIVE_MODE)(`Tier B live experiments — phase: ${PHASE || '(none)'}`, () => {
  let mastra: Mastra;

  beforeAll(async () => {
    mastra = createEvalMastra(); // EVAL_STORAGE_URL (throwaway file) honored
    const seeds = await seedEvalDatasets(mastra);
    const research = seeds.find(s => s.datasetId === 'research-qa');
    expect(research, 'research-qa dataset must seed').toBeDefined();
  }, 120_000);

  it('baseline phase: run baseline-main against the pinned version + refresh artifacts', async () => {
    expect(PHASE).toBe('baseline');
    const dataset = await mastra.datasets.get({ id: 'research-qa' });
    const pinned = (await dataset.getDetails()).version; // DatasetRecord.version (corrected API)

    const summary = await dataset.startExperiment({
      name: 'baseline-main',
      targetType: 'agent',
      targetId: 'research-agent',
      scorers: ['answer-relevancy', 'faithfulness', 'hallucination', 'keyword-coverage'],
      version: pinned,
      maxConcurrency: 5,
      maxRetries: 2,
      itemTimeout: 30_000,
    });
    expect(summary.status).not.toBe('failed');

    const state: LiveState = {
      datasetId: 'research-qa',
      datasetVersion: pinned,
      baselineExperimentId: summary.experimentId,
    };
    writeState(state);
    appendSummary(
      `### Tier B baseline\n- experiment \`${summary.experimentId}\` (dataset v${pinned})\n` +
        `- ${summary.succeededCount}/${summary.totalItems} items succeeded\n`
    );
    refreshArtifactsFromSummary(summary, pinned);
  }, 900_000);

  it('candidate phase: run pr-<run-id> on the SAME pinned version', async () => {
    expect(PHASE).toBe('candidate');
    const prior = readState();
    const dataset = await mastra.datasets.get({ id: prior.datasetId });
    // NEVER silently 'latest': pin the exact version the baseline used.
    const summary = await dataset.startExperiment({
      name: `pr-${process.env.GITHUB_RUN_ID ?? 'local'}`,
      targetType: 'agent',
      targetId: 'research-agent',
      scorers: ['answer-relevancy', 'faithfulness', 'hallucination', 'keyword-coverage'],
      version: prior.datasetVersion,
      maxConcurrency: 5,
      maxRetries: 2,
      itemTimeout: 30_000,
    });

    writeState({
      ...prior,
      candidateExperimentId: summary.experimentId,
      candidateModel: process.env.MODEL_RESEARCH,
    });
    appendSummary(
      `### Tier B candidate\n- experiment \`${summary.experimentId}\` ` +
        `(dataset v${prior.datasetVersion}, model ${process.env.MODEL_RESEARCH ?? 'env-default'})\n`
    );
  }, 900_000);

  it('compare phase: compareExperiments report → step summary + artifact', async () => {
    expect(PHASE).toBe('compare');
    const prior = readState();
    expect(prior.baselineExperimentId).toBeDefined();

    const experimentIds = [prior.baselineExperimentId, prior.candidateExperimentId].filter(
      (x): x is string => Boolean(x)
    );
    const report = await mastra.datasets.compareExperiments({
      experimentIds,
      baselineId: prior.baselineExperimentId!,
    });

    // verified shape: results keyed by experimentId; scores numeric-only.
    const rows: string[] = [
      '### compareExperiments report',
      `dataset \`${prior.datasetId}\` v${prior.datasetVersion} · baseline \`${prior.baselineExperimentId}\``,
      '',
      '| item | scorer | baseline | candidate | Δ |',
      '|---|---|---|---|---|',
    ];
    for (const item of report.items) {
      const b = item.results[prior.baselineExperimentId!]?.scores ?? {};
      const c = prior.candidateExperimentId
        ? (item.results[prior.candidateExperimentId]?.scores ?? {})
        : {};
      for (const scorerId of Object.keys({ ...b, ...c })) {
        const bv = b[scorerId];
        const cv = c[scorerId];
        const delta =
          typeof bv === 'number' && typeof cv === 'number' ? (cv - bv).toFixed(3) : 'n/a';
        rows.push(`| ${item.itemId} | ${scorerId} | ${bv ?? '—'} | ${cv ?? '—'} | ${delta} |`);
      }
    }
    appendSummary(`${rows.join('\n')}\n`);
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(
      path.join(STATE_DIR, 'compare-report.json'),
      `${JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8'
    );
  }, 120_000);
});

describe.skipIf(LIVE_MODE)('Tier B live experiments — inert without EVALS_LIVE_MODE', () => {
  it('skips cleanly on PR jobs (forks AND same-repo): never false-red', () => {
    expect(true).toBe(true);
  });
});
