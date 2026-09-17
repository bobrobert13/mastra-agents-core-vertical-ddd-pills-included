import { createTool } from '@mastra/core/tools';
import { requireAppDb } from '../../../shared/config/db';
import { logger } from '../../../shared/logger';
import { eventBus, makeEvent } from '../../../shared/events';
import { createTaskRepository } from '../repo';
import { taskScheduledEvent } from '../events';
import { TASK_MANAGEMENT_AGENT_ID, TASK_SCHEDULE_ID_PREFIX } from '../config';
import { intervalToCron } from '../schedule/interval';
import { syncTaskSchedule } from '../schedule/sync';
import {
  scheduleTaskInputSchema,
  scheduleTaskOutputSchema,
  type ScheduleFailureReason,
} from '../schedule/schemas';

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
 * `task-management-agent`. Interval parsing lives in `../schedule/interval`,
 * the create-or-update in `../schedule/sync`, the schemas in `../schedule/schemas`.
 */
export { intervalToCron };

export const scheduleTaskTool = createTool({
  id: 'task-schedule',
  description:
    'Schedule a recurring reminder prompt for an existing task (real persisted cron schedule on the agent)',
  inputSchema: scheduleTaskInputSchema,
  outputSchema: scheduleTaskOutputSchema,
  execute: async (
    { taskId, cron, interval, timezone, prompt, schedule, enabled = true },
    context
  ) => {
    const fail = (reason: ScheduleFailureReason, message: string) => ({
      taskId,
      scheduled: false,
      reason,
      message,
    });

    // --- resolve the schedule spec (nested form wins over flat) ------------
    const spec = schedule ?? {};
    const rawCron = spec.cron ?? cron;
    const rawInterval = spec.interval ?? interval;
    const tz = spec.timezone ?? timezone;
    const reminderPrompt = spec.prompt ?? prompt;

    const resolvedCron = rawCron ?? (rawInterval ? intervalToCron(rawInterval) : null);
    if (!resolvedCron) {
      return fail(
        'INVALID_SCHEDULE',
        'Provide a cron expression or an interval like "15m" / "1h" / "2d".'
      );
    }

    // --- the platform owns scheduling: degrade honestly without mastra -----
    const schedules = context?.mastra?.schedules;
    if (!schedules) {
      return fail(
        'SCHEDULING_UNAVAILABLE',
        'schedule_task needs the Mastra runtime (context.mastra.schedules); it is not available in this execution context.'
      );
    }

    let db;
    try {
      db = await requireAppDb('task-schedule');
    } catch {
      return fail('SCHEDULE_ERROR', 'No application database connection could be opened.');
    }
    const repo = createTaskRepository(db);

    const task = await repo.getTask(taskId);
    if (!task) {
      return fail('TASK_NOT_FOUND', `Task ${taskId} not found — no schedule was created.`);
    }

    const rawId = `${TASK_SCHEDULE_ID_PREFIX}${taskId}`;
    const reminder =
      reminderPrompt ??
      `Reminder: task ${taskId} — "${task.title}" is due for review (cron ${resolvedCron}).`;

    // create-or-update (the storage API throws on duplicate ids; this tool is
    // idempotent per task instead) ------------------------------------------
    const synced = await syncTaskSchedule(schedules, {
      taskId,
      scheduleId: rawId,
      agentId: TASK_MANAGEMENT_AGENT_ID,
      cron: resolvedCron,
      timezone: tz,
      prompt: reminder,
      enabled,
    });
    if (!synced.ok) {
      return fail('SCHEDULE_ERROR', synced.message);
    }
    const row = synced.row;

    // Record the real row id (normalized `agent_task-…`) on the task row.
    const attached = await repo.attachSchedule(taskId, row.id);
    if (!attached) {
      logger.warn(
        `[schedule_task] schedule ${row.id} created but task ${taskId} vanished; row not linked.`
      );
    }

    const event = makeEvent(taskScheduledEvent, {
      taskId,
      scheduleId: row.id,
      interval: resolvedCron,
      timestamp: new Date(),
    });
    await eventBus.publish(event);

    logger.info(
      `[schedule_task] task ${taskId} → schedule ${row.id} (${resolvedCron}${tz ? ` ${tz}` : ''})`
    );

    return {
      taskId,
      scheduled: true,
      scheduleId: row.id,
      cron: resolvedCron,
      nextFireAt: row.nextFireAt,
      message: `Reminder schedule ${row.id} is ${enabled ? 'active' : 'paused'} for task ${taskId} (cron ${resolvedCron}).`,
    };
  },
});
