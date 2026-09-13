/**
 * Seed native eval datasets from the canonical git JSON
 * (tests/evals/datasets/*.json) — spec 07 §3.1.
 *
 *   npm run seed:eval-datasets
 *   ⇒ node --experimental-strip-types scripts/seed-eval-datasets.ts
 *
 * Storage: EVAL_STORAGE_URL, defaulting to the THROWAWAY `file:./eval-ci.db`
 * (never the app's mastra.db — eval churn must not pollute dev/prod data).
 * Re-runnable: items already present (matched by externalId) are skipped, so
 * a second run adds nothing (idempotent seed; dataset version only bumps on
 * real mutation).
 *
 * STRIP-TYPES RULE: every local import below carries an explicit `.ts`
 * extension; only package + node builtin imports are extensionless.
 */

import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';

import { EVAL_CI_DB_URL, EVAL_STORAGE_RETENTION, resolveEvalStorageUrl } from '../src/mastra/shared/evals/eval-storage.ts';
import { seedEvalDatasets } from '../src/mastra/shared/evals/seed.ts';

const url = resolveEvalStorageUrl(EVAL_CI_DB_URL);

console.log(`[seed-eval-datasets] storage: ${url}`);

const mastra = new Mastra({
  storage: new LibSQLStore({ id: 'eval-seed-storage', url, ...EVAL_STORAGE_RETENTION }),
});

try {
  const results = await seedEvalDatasets(mastra);
  for (const r of results) {
    console.log(
      `[seed-eval-datasets] ${r.datasetId}: ${r.created ? 'created' : 'exists'} · ` +
        `+${r.added} added · ${r.skipped} skipped · ${r.total} total · version ${r.version}`
    );
  }
  const totalAdded = results.reduce((a, r) => a + r.added, 0);
  console.log(`[seed-eval-datasets] done (${totalAdded} new items).`);
} catch (error) {
  console.error('[seed-eval-datasets] FAILED:', error);
  process.exitCode = 1;
}
