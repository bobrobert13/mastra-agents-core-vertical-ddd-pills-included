/**
 * Eval-storage resolution (spec 07 §3.1 / ADR-010).
 *
 * Evals NEVER touch the app storage (`file:./mastra.db` / DATABASE_URL):
 * dataset/experiment churn from CI would pollute dev/prod data. Every eval
 * run gets a THROWAWAY LibSQL location:
 *
 *   EVAL_STORAGE_URL set  → use it (CI/live workflow: `file:./eval-ci.db`)
 *   unset                 → caller's default (tests: `:memory:`; seed script:
 *                           `file:./eval-ci.db`)
 *
 * Zero-config rule: unset is never an error.
 */

import type { RetentionConfig } from '@mastra/core/storage';

/** Eval runs seed into a throwaway DB; tests default to in-process memory. */
export function resolveEvalStorageUrl(defaultUrl = ':memory:'): string {
  const value = process.env.EVAL_STORAGE_URL;
  return value && value.trim() !== '' ? value.trim() : defaultUrl;
}

/** Script/CLI default: a throwaway file, gitignored via the *.db* entries. */
export const EVAL_CI_DB_URL = 'file:./eval-ci.db';

/**
 * Retention posture (spec 07 §3.4 risk 2, ADR-010): experiments + their
 * cascaded results and emitted scores age out after 90 days; running
 * experiments (NULL completedAt) are never pruned. DATASETS ARE DELIBERATELY
 * ABSENT — user-authored config is not retention-eligible; dataset cleanup
 * is explicit (`mastra.datasets.delete` / `purgeItem`), and size is bounded
 * by the git-seed pattern (storage mirrors small, reviewed JSON).
 *
 * Spread into the LibSQL/Postgres store config by the composition root:
 *   new LibSQLStore({ id, url, ...EVAL_STORAGE_RETENTION })
 */
export const EVAL_STORAGE_RETENTION = {
  retention: {
    experiments: { experiments: { maxAge: '90d' } },
    scores: { scorers: { maxAge: '90d' } },
  },
} satisfies { retention: RetentionConfig };
