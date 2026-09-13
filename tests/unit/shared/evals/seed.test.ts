import { describe, expect, it } from 'vitest';

import {
  EVAL_STORAGE_RETENTION,
  resolveEvalStorageUrl,
  EVAL_CI_DB_URL,
} from '../../../../src/mastra/shared/evals/eval-storage';
import {
  EVAL_SEED_SPECS,
  seedEvalDatasets,
  seedDatasetPath,
} from '../../../../src/mastra/shared/evals/seed';
import {
  checkBaselineRegression,
  MAX_BASELINE_DELTA,
} from '../../../../src/mastra/shared/evals/baseline-check';
import { readFileSync } from 'node:fs';
import { createEvalMastra } from '../../../evals/eval-instance';
import researchJson from '../../../evals/datasets/research-dataset.json';
import taskJson from '../../../evals/datasets/task-dataset.json';

/**
 * Seeding + storage posture unit tests (spec 07 §3.1, ADR-010).
 * In-memory: zero-config, offline-safe.
 */
describe('eval storage resolution (zero-config rule)', () => {
  it('unset ⇒ caller default, never an error', () => {
    const saved = process.env.EVAL_STORAGE_URL;
    delete process.env.EVAL_STORAGE_URL;
    expect(resolveEvalStorageUrl()).toBe(':memory:');
    expect(resolveEvalStorageUrl('file:./x.db')).toBe('file:./x.db');
    process.env.EVAL_STORAGE_URL = '   ';
    expect(resolveEvalStorageUrl()).toBe(':memory:');
    process.env.EVAL_STORAGE_URL = 'file:/tmp/elsewhere.db';
    expect(resolveEvalStorageUrl()).toBe('file:/tmp/elsewhere.db');
    if (saved === undefined) delete process.env.EVAL_STORAGE_URL;
    else process.env.EVAL_STORAGE_URL = saved;
  });

  it('CI/script throwaway default is eval-ci.db (never the app DB)', () => {
    expect(EVAL_CI_DB_URL).toBe('file:./eval-ci.db');
  });

  it('retention covers experiments + scores; DATASETS deliberately excluded (ADR-010)', () => {
    const retention = EVAL_STORAGE_RETENTION.retention as Record<string, unknown>;
    expect(retention.experiments).toEqual({ experiments: { maxAge: '90d' } });
    expect(retention.scores).toEqual({ scorers: { maxAge: '90d' } });
    expect(retention.datasets).toBeUndefined();
  });
});

describe('seed specs ↔ canonical JSON', () => {
  it('two specs (research-qa, task-qa) with ≥ 10 items each, still schema-valid seeds', () => {
    expect(EVAL_SEED_SPECS.map(s => s.datasetId)).toEqual(['research-qa', 'task-qa']);
    expect(researchJson.items.length).toBeGreaterThanOrEqual(10);
    expect(taskJson.items.length).toBeGreaterThanOrEqual(10);
    for (const spec of EVAL_SEED_SPECS) {
      const items = JSON.parse(readFileSync(seedDatasetPath(spec.file), 'utf8')).items;
      for (const item of items) {
        expect(
          spec.inputSchema.safeParse(item.input).success,
          `${spec.datasetId}/${item.id} input`
        ).toBe(true);
        expect(
          spec.groundTruthSchema.safeParse(item.groundTruth).success,
          `${spec.datasetId}/${item.id} groundTruth`
        ).toBe(true);
      }
    }
  });
});

describe('seedEvalDatasets — native storage + idempotency', () => {
  it('fresh DB: creates both datasets; re-run adds zero duplicates (DoD: run twice ⇒ no dupes)', async () => {
    const mastra = createEvalMastra({ storageUrl: ':memory:' });

    const first = await seedEvalDatasets(mastra);
    expect(first.map(r => r.datasetId).sort()).toEqual(['research-qa', 'task-qa']);
    for (const r of first) {
      expect(r.created).toBe(true);
      expect(r.added).toBeGreaterThanOrEqual(10);
    }

    const second = await seedEvalDatasets(mastra);
    for (const r of second) {
      expect(r.created).toBe(false);
      expect(r.added).toBe(0);
    }

    const list = await mastra.datasets.list({});
    expect(list.datasets.length).toBe(2);
    expect(list.datasets.every(d => d.version >= 1)).toBe(true);
  });

  it('create is idempotent-safe when a same-NAMED dataset exists (lookup by name, not assumed id)', async () => {
    const mastra = createEvalMastra({ storageUrl: ':memory:' });
    // pre-create research-qa via the spec-less path (simulates drift/merge)
    await mastra.datasets.create({ id: 'research-qa', name: 'research-qa' });
    const res = await seedEvalDatasets(mastra);
    const research = res.find(r => r.datasetId === 'research-qa');
    expect(research?.created).toBe(false);
    expect(research?.added).toBe(researchJson.items.length);
  });
});

describe('baseline regression math (spec 07 §3.3)', () => {
  const baseline = {
    schemaVersion: 1 as const,
    generatedAt: 'x',
    source: 'unit',
    means: { 'a::s1': 0.8, 'a::s2': 0.5 },
  };

  it('flag drop > 0.02 only; exactly-at-tolerance and improvements pass', () => {
    expect(checkBaselineRegression({ 'a::s1': 0.78 }, baseline)).toHaveLength(0); // Δ = 0.02
    expect(checkBaselineRegression({ 'a::s1': 0.779 }, baseline)).toHaveLength(1); // Δ > 0.02
    expect(checkBaselineRegression({ 'a::s1': 0.9 }, baseline)).toHaveLength(0); // improvement
  });

  it('new/untracked keys never regress; missing observed keys are skipped', () => {
    expect(checkBaselineRegression({ 'a::brand-new': 0.0 }, baseline)).toHaveLength(0);
    expect(checkBaselineRegression({}, baseline)).toHaveLength(0);
  });

  it('MAX_BASELINE_DELTA is the spec-pinned 0.02', () => {
    expect(MAX_BASELINE_DELTA).toBe(0.02);
  });
});
