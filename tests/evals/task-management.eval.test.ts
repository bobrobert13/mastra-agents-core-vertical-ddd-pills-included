import { beforeAll, describe, expect, it } from 'vitest';
import type { Mastra } from '@mastra/core/mastra';

import { taskManagementAgent } from '../../src/mastra/domains/task-management';
import { resolveModel } from '../../src/mastra/shared/config/model';
import { createEvalMastra } from './eval-instance';
import { seedEvalDatasets, type SeedResult } from '../../src/mastra/shared/evals/seed';
import taskDataset from './datasets/task-dataset.json';

/**
 * Task-management eval contract (spec 07 §3.1): canonical JSON mirrored into
 * native `mastra.datasets`, validated for count/identity/schema + idempotent
 * re-seed. Fixtures assert `expectedTools`/`expectedPriority`/
 * `expectedStatus` — mapped to checks/groundTruth at gate level
 * (§3.2 note). Scoring gates: `gates/task-management.gates.test.ts`.
 */
let mastra: Mastra;
let firstSeed: SeedResult[];

beforeAll(async () => {
  mastra = createEvalMastra({ storageUrl: ':memory:' });
  firstSeed = await seedEvalDatasets(mastra);
});

describe('task dataset — seeded into native storage (offline)', () => {
  it('agent is registered and on the resolved model (legacy identity contract)', () => {
    expect(taskManagementAgent).toBeDefined();
    expect(taskManagementAgent.id).toBe('task-management-agent');
    expect(taskManagementAgent.model).toBe(resolveModel('tasks'));
  });

  it('canonical JSON has ≥ 10 items, unique ids, executable tool expectations', () => {
    const items = taskDataset.items;
    expect(items.length).toBeGreaterThanOrEqual(10);
    const ids = new Set(items.map(i => i.id));
    expect(ids.size).toBe(items.length);
    const knownTools = new Set(['create_task', 'update_task', 'schedule_task']);
    for (const item of items) {
      expect(typeof item.input.query).toBe('string');
      expect(item.groundTruth.expectedTools.length).toBeGreaterThan(0);
      for (const tool of item.groundTruth.expectedTools) expect(knownTools.has(tool)).toBe(true);
    }
  });

  it('seeds the task-qa dataset: JSON ↔ storage parity', async () => {
    const result = firstSeed.find(r => r.datasetId === 'task-qa');
    expect(result?.created).toBe(true);
    expect(result?.added).toBe(taskDataset.items.length);

    const dataset = await mastra.datasets.get({ id: 'task-qa' });
    const listed = await dataset.listItems({ page: 0, perPage: 1000 });
    const items = Array.isArray(listed) ? listed : listed.items;
    expect(items.map(i => i.externalId).sort()).toEqual(taskDataset.items.map(i => i.id).sort());
  });

  it('dataset binds the task agent target + offline scorer registry ids', async () => {
    const dataset = await mastra.datasets.get({ id: 'task-qa' });
    const details = await dataset.getDetails();
    expect(details.targetIds).toContain('task-management-agent');
    expect(details.scorerIds).toEqual(
      expect.arrayContaining(['completeness-scorer', 'keyword-coverage'])
    );
  });

  it('re-seed is IDEMPOTENT: zero new items, zero duplicates', async () => {
    const again = await seedEvalDatasets(mastra);
    const tasks = again.find(r => r.datasetId === 'task-qa');
    expect(tasks?.created).toBe(false);
    expect(tasks?.added).toBe(0);
    expect(tasks?.skipped).toBe(taskDataset.items.length);
    expect(tasks?.total).toBe(taskDataset.items.length);
  });

  it('schema is enforced at insert (invalid groundTruth rejected)', async () => {
    const dataset = await mastra.datasets.get({ id: 'task-qa' });
    await expect(
      dataset.addItems({
        items: [{ input: { query: 'x' }, groundTruth: { expectedTools: 'create_task' } }],
      })
    ).rejects.toThrow();
  });
});
