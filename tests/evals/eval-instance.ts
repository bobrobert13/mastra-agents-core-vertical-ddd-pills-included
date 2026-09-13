/**
 * Eval-scoped Mastra instance builder (test-side composition; spec 07 §3.3).
 *
 * Lives in tests/ because it imports the domain barrels to register real
 * agents — legal for the eval tier, forbidden in `shared/` (vertical-slice
 * rule). Composition of the SHIPPED instance stays in `src/mastra/index.ts`;
 * this is a minimal throwaway twin used by the eval suites and the Tier B
 * workflow runner: eval-only storage location (`EVAL_STORAGE_URL`, else
 * `:memory:` — never the app's mastra.db), the §3.2 scorer registry (so
 * `startExperiment({ scorers: ['answer-relevancy'] })` resolves IDs and
 * Studio lists them), the four agents as experiment targets, and the
 * ADR-010 retention posture (experiments + scores age out; datasets excluded).
 */

import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';

import { researchAgent } from '../../src/mastra/domains/research';
import { taskManagementAgent } from '../../src/mastra/domains/task-management';
import { fileOperationsAgent } from '../../src/mastra/domains/file-operations';
import { communicationAgent } from '../../src/mastra/domains/communication';

import {
  buildEvalScorers,
  EVAL_STORAGE_RETENTION,
  resolveEvalStorageUrl,
} from '../../src/mastra/shared/evals';

export interface EvalInstanceOptions {
  /** Override the storage URL (contract tests pin ':memory:'). */
  storageUrl?: string;
}

export function createEvalMastra(opts: EvalInstanceOptions = {}): Mastra {
  const url = opts.storageUrl ?? resolveEvalStorageUrl(':memory:');
  const storage = new LibSQLStore({
    id: 'eval-storage',
    url,
    ...EVAL_STORAGE_RETENTION,
  });

  return new Mastra({
    storage,
    scorers: buildEvalScorers(),
    agents: {
      research: researchAgent,
      tasks: taskManagementAgent,
      files: fileOperationsAgent,
      comms: communicationAgent,
    },
  });
}
