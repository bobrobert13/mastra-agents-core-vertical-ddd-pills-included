/**
 * Eval dataset seeding (spec 07 §3.1, ADR-010).
 *
 * The git JSON files under `tests/evals/datasets/*.json` stay the reviewed,
 * diffable SOURCE OF TRUTH; this module pushes them into Mastra's native
 * `datasets` storage service idempotently (storage becomes the runtime
 * record: versioned items, Studio-visible, experiment-pinnable).
 *
 * Exported as `seedEvalDatasets(mastra)` so the seed script, the eval tier,
 * and the live workflow all share ONE implementation.
 *
 * NODE-STRIP-TYPES CONSTRAINT: this module is executed directly by
 * `scripts/seed-eval-datasets.ts` under `node --experimental-strip-types`,
 * so it may import ONLY packages + node builtins — no local extensionless
 * imports (which the strip-types loader cannot resolve).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

import type { Mastra } from '@mastra/core/mastra';
import type { Dataset } from '@mastra/core/datasets';

/** Repository-root-relative location of the canonical seed JSON. */
const DATASETS_DIR = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../tests/evals/datasets'
);

export interface EvalSeedSpec {
  /** Deterministic caller-supplied storage id. */
  datasetId: string;
  name: string;
  description: string;
  /** JSON file (in DATASETS_DIR) mirroring this dataset. */
  file: string;
  inputSchema: z.ZodTypeAny;
  groundTruthSchema: z.ZodTypeAny;
  targetIds: string[];
  /** Instance-registry IDs resolvable by startExperiment (spec §3.2). */
  scorerIds: string[];
}

export interface SeedResult {
  datasetId: string;
  created: boolean;
  added: number;
  skipped: number;
  total: number;
  version: number;
}

/** The seed set (spec §3.1): research + task-management are the required domains. */
export const EVAL_SEED_SPECS: EvalSeedSpec[] = [
  {
    datasetId: 'research-qa',
    name: 'research-qa',
    description:
      'Research agent eval cases (seeded from tests/evals/datasets/research-dataset.json)',
    file: 'research-dataset.json',
    inputSchema: z.object({ query: z.string() }),
    groundTruthSchema: z.object({
      expectedAnswer: z.string(),
      requiredTools: z.array(z.string()),
      minSources: z.number(),
    }),
    targetIds: ['research-agent'],
    scorerIds: [
      'answer-relevancy',
      'faithfulness',
      'hallucination',
      'completeness-scorer',
      'keyword-coverage',
      'research-relevance',
    ],
  },
  {
    datasetId: 'task-qa',
    name: 'task-qa',
    description:
      'Task management agent eval cases (seeded from tests/evals/datasets/task-dataset.json)',
    file: 'task-dataset.json',
    inputSchema: z.object({ query: z.string() }),
    groundTruthSchema: z.object({
      expectedTools: z.array(z.string()),
      expectedStatus: z.string().optional(),
      expectedPriority: z.string().optional(),
    }),
    targetIds: ['task-management-agent'],
    scorerIds: ['completeness-scorer', 'keyword-coverage'],
  },
];

function readSeedItems(spec: EvalSeedSpec): Array<{
  id: string;
  input: unknown;
  groundTruth: unknown;
}> {
  const raw = readFileSync(path.join(DATASETS_DIR, spec.file), 'utf8');
  const parsed = JSON.parse(raw) as {
    items?: Array<{ id: string; input: unknown; groundTruth: unknown }>;
  };
  if (!Array.isArray(parsed.items)) {
    throw new Error(`Eval seed "${spec.file}" has no items[] array`);
  }
  return parsed.items;
}

/**
 * Idempotently seed every `EVAL_SEED_SPECS` dataset into native storage.
 * Re-running on the same DB adds nothing (externalId carries the stable
 * JSON `id`, so identity survives SCD-2 versioning).
 */
export async function seedEvalDatasets(
  mastra: Mastra,
  specs: EvalSeedSpec[] = EVAL_SEED_SPECS
): Promise<SeedResult[]> {
  const results: SeedResult[] = [];

  for (const spec of specs) {
    const existing = await mastra.datasets.list({ filters: { name: spec.name } });
    const found = existing.datasets.find(d => d.name === spec.name) ?? null;

    let dataset: Dataset;
    let created = false;
    if (found) {
      dataset = await mastra.datasets.get({ id: found.id });
    } else {
      dataset = await mastra.datasets.create({
        id: spec.datasetId,
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
        groundTruthSchema: spec.groundTruthSchema,
        targetType: 'agent',
        targetIds: spec.targetIds,
        scorerIds: spec.scorerIds,
      });
      created = true;
    }

    const items = readSeedItems(spec);

    // Load every item (paginated shape) to build the existing-externalId set.
    const seenExternalIds = new Set<string>();
    const listed = await dataset.listItems({ page: 0, perPage: 1000 });
    const pageItems = Array.isArray(listed) ? listed : listed.items;
    for (const it of pageItems) {
      if (it.externalId) seenExternalIds.add(it.externalId);
    }

    const fresh = items.filter(i => !seenExternalIds.has(i.id));
    if (fresh.length > 0) {
      await dataset.addItems({
        items: fresh.map(i => ({
          input: i.input,
          groundTruth: i.groundTruth,
          externalId: i.id,
        })),
      });
    }

    const details = await dataset.getDetails();
    const after = await dataset.listItems({ page: 0, perPage: 1000 });
    const totalCount = Array.isArray(after) ? after.length : after.items.length;

    results.push({
      datasetId: spec.datasetId,
      created,
      added: fresh.length,
      skipped: items.length - fresh.length,
      total: totalCount,
      version: details.version,
    });
  }

  return results;
}

/** Absolute path to a seed JSON file (for the eval tier's parity checks). */
export function seedDatasetPath(file: string): string {
  return path.join(DATASETS_DIR, file);
}
