import { createWorkflow } from '@mastra/core/workflows';
import { DIGEST_SCHEDULE_CRON, DIGEST_SCHEDULE_TIMEZONE } from '../config';
import { collectOpenTasksStep } from './steps/collect-open-tasks';
import { buildDigestStep } from './steps/build-digest';
import { dailyDigestInputSchema, digestOutputSchema } from './schemas';

/**
 * daily-digest — LLM-free by design so it fires in zero-config /
 * provider-less mode (spec 05 §3.5). Declares a single schedule → row id
 * `wf_daily-digest`; scheduled fires and manual `createRun()` share the
 * public API. LibSQL satisfies the evented-engine concurrency requirement
 * (spec 05 §3.6).
 *
 * Pure composition: the steps live under `steps/`, the shared inter-step
 * schemas under `schemas.ts`. The five names below are re-exported so the
 * historic `.../workflows/daily-digest` import surface is unchanged.
 *
 * Register in `src/mastra/index.ts` `workflows` map (unregistered = invisible).
 */
export const dailyDigestWorkflow = createWorkflow({
  id: 'daily-digest',
  description: 'Cron-fired digest of open tasks (proves the scheduler path)',
  inputSchema: dailyDigestInputSchema,
  outputSchema: digestOutputSchema,
  schedule: {
    // single form → declarative row id `wf_daily-digest` (boot sync)
    cron: DIGEST_SCHEDULE_CRON,
    timezone: DIGEST_SCHEDULE_TIMEZONE, // explicit — host-tz default flagged in spec
    inputData: { resourceId: 'default' },
  },
})
  .then(collectOpenTasksStep)
  .then(buildDigestStep)
  .commit();

export { collectOpenTasksStep, collectOpenTasks } from './steps/collect-open-tasks';
export { buildDigestStep, buildDigest } from './steps/build-digest';
export type { DigestWindow } from './schemas';
