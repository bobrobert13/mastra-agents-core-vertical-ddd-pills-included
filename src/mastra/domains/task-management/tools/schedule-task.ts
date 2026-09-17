import { createTool } from '@mastra/core/tools';
import { isFail } from '../../../shared/handlers';
import { executeScheduleTask } from '../functions/schedule-task';
import { toScheduleFailureReason } from '../handlers/responses';
import { intervalToCron } from '../schedule/interval';
import { scheduleTaskInputSchema, scheduleTaskOutputSchema } from '../schedule/schemas';

/**
 * schedule_task creates a real, durable **agent reminder schedule** via
 * `mastra.schedules` (spec 05 §3.4). The row id is `task-<taskId>`, which the
 * Schedules service normalizes to `agent_task-<slug(taskId)>` — the `agent_`
 * prefix applies to agent schedules (`schedule_` is the imperative
 * workflow-schedule prefix; `wf_` is reserved for declarative rows).
 *
 * Honest restriction: the scheduler fires agents (prompt) or workflows
 * (inputData); there is no "run an arbitrary Task row" primitive, and this
 * agent explicitly does not execute work. A fire = reminder prompt into the
 * `task-management-agent`. The logic lives in `../functions/schedule-task`;
 * this file is a thin adapter mapping its typed result back to the schema.
 */
export { intervalToCron };

export const scheduleTaskTool = createTool({
  id: 'task-schedule',
  description:
    'Schedule a recurring reminder prompt for an existing task (real persisted cron schedule on the agent)',
  inputSchema: scheduleTaskInputSchema,
  outputSchema: scheduleTaskOutputSchema,
  execute: async (input, context) => {
    const result = await executeScheduleTask(input, { schedules: context?.mastra?.schedules });

    if (isFail(result)) {
      return {
        taskId: input.taskId,
        scheduled: false,
        reason: toScheduleFailureReason(result.error),
        message: result.error.message,
      };
    }

    const outcome = result.unwrap();
    return {
      taskId: outcome.taskId,
      scheduled: true,
      scheduleId: outcome.scheduleId,
      cron: outcome.cron,
      nextFireAt: outcome.nextFireAt,
      message: `Reminder schedule ${outcome.scheduleId} is ${
        outcome.enabled ? 'active' : 'paused'
      } for task ${outcome.taskId} (cron ${outcome.cron}).`,
    };
  },
});
