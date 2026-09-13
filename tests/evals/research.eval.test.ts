import { beforeAll, describe, expect, it } from 'vitest';
import type { Mastra } from '@mastra/core/mastra';

import { researchAgent } from '../../src/mastra/domains/research';
import { resolveModel } from '../../src/mastra/shared/config/model';
import { createEvalMastra } from './eval-instance';
import { seedEvalDatasets, type SeedResult } from '../../src/mastra/shared/evals/seed';
import researchDataset from './datasets/research-dataset.json';

/**
 * Research eval contract (spec 07 §3.1): the git JSON stays canonical and
 * `seedEvalDatasets` mirrors it into Mastra's NATIVE dataset storage — this
 * suite validates THAT (counts, externalId uniqueness, schema acceptance,
 * JSON↔storage parity, idempotent re-seed) instead of the old shallow
 * structural checks. In-process `:memory:` storage: zero-config, parallel
 * safe, never touches the app DB. The blocking score gates live in
 * `gates/research.gates.test.ts` (Tier A) — this file is the schema tier.
 */
let mastra: Mastra;
let firstSeed: SeedResult[];

beforeAll(async () => {
  mastra = createEvalMastra({ storageUrl: ':memory:' });
  firstSeed = await seedEvalDatasets(mastra);
});

describe('research dataset — seeded into native storage (offline)', () => {
  it('agent is registered and on the resolved model (legacy identity contract)', () => {
    expect(researchAgent).toBeDefined();
    expect(researchAgent.id).toBe('research-agent');
    expect(researchAgent.model).toBe(resolveModel('research'));
  });

  it('canonical JSON has ≥ 10 items with unique ids and the input/groundTruth contract', () => {
    const items = researchDataset.items;
    expect(items.length).toBeGreaterThanOrEqual(10);
    const ids = new Set(items.map(i => i.id));
    expect(ids.size).toBe(items.length);
    for (const item of items) {
      expect(typeof item.input.query).toBe('string');
      expect(item.input.query.trim().length).toBeGreaterThan(0);
      expect(typeof item.groundTruth.expectedAnswer).toBe('string');
      expect(Array.isArray(item.groundTruth.requiredTools)).toBe(true);
      expect(typeof item.groundTruth.minSources).toBe('number');
    }
  });

  it('seeds the research-qa dataset: JSON ↔ storage parity (≥ 10 items)', async () => {
    const result = firstSeed.find(r => r.datasetId === 'research-qa');
    expect(result?.created).toBe(true);
    expect(result?.added).toBe(researchDataset.items.length);
    expect(result?.total).toBe(researchDataset.items.length);

    const dataset = await mastra.datasets.get({ id: 'research-qa' });
    const listed = await dataset.listItems({ page: 0, perPage: 1000 });
    const items = Array.isArray(listed) ? listed : listed.items;
    expect(items.map(i => i.externalId).sort()).toEqual(researchDataset.items.map(i => i.id).sort());
  });

  it('dataset record carries the §3.1 target + scorer registrations', async () => {
    const dataset = await mastra.datasets.get({ id: 'research-qa' });
    const details = await dataset.getDetails();
    expect(details.targetIds).toContain('research-agent');
    expect(details.scorerIds).toEqual(
      expect.arrayContaining([
        'answer-relevancy',
        'faithfulness',
        'hallucination',
        'completeness-scorer',
        'keyword-coverage',
        'research-relevance',
      ])
    );
    expect(details.version).toBeGreaterThanOrEqual(1);
  });

  it('re-seed is IDEMPOTENT: zero new items, zero duplicates', async () => {
    const again = await seedEvalDatasets(mastra);
    const research = again.find(r => r.datasetId === 'research-qa');
    expect(research?.created).toBe(false);
    expect(research?.added).toBe(0);
    expect(research?.skipped).toBe(researchDataset.items.length);
    expect(research?.total).toBe(researchDataset.items.length);
  });

  it('schema is enforced at insert (invalid item rejected)', async () => {
    const dataset = await mastra.datasets.get({ id: 'research-qa' });
    await expect(
      dataset.addItems({
        items: [
          {
            input: { notAQuery: 42 },
            groundTruth: { expectedAnswer: 'x', requiredTools: [], minSources: 0 },
          },
        ],
      })
    ).rejects.toThrow();
  });
});
