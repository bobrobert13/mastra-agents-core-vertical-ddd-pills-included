import { createTool } from '@mastra/core/tools';
import type { AnySchedule } from '@mastra/core/schedules';
import { z } from 'zod';
import { getAppDb } from '../../../shared/config/db';
import { logger } from '../../../shared/logger';
import { eventBus } from '../../../shared/events';
import { createTaskRepository } from '../repo';
import type { TaskScheduledEvent } from '../events';

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
 * `task-management-agent`.
 */
const AGENT_ID = 'task-management-agent';

const INTERVAL_RE = /^(\d+)(m|h|d)$/;

/** Back-compat: convert `15m` / `1h` / `2d` to the equivalent cron. */
export function intervalToCron(interval: string): string | null {
  const match = INTERVAL_RE.exec(interval.trim());
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n <= 0) return null;
  switch (match[2]) {
    case 'm':
      return `*/${n} * * * *`;
    case 'h':
      return `0 */${n} * * *`;
    case 'd':
      return `0 0 */${n} * * *`;
    default:
      return null;
  }
}

function isIdConflictError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'SCHEDULES_ID_EXISTS'
  );
}

export const scheduleTaskTool = createTool({
  id: 'task-schedule',
  description:
    'Schedule a recurring reminder prompt for an existing task (real persisted cron schedule on the agent)',
  inputSchema: z.object({
    taskId: z.string().describe('Task ID to schedule a reminder for'),
    cron: z.string().optional().describe('Cron expression, e.g. "0 9 * * *" (daily 9am)'),
    interval: z
      .string()
      .optional()
      .describe('Back-compat interval, e.g. "15m", "1h", "2d" — converted to a cron'),
    timezone: z.string().optional().describe('IANA timezone, e.g. "Europe/Madrid" (default: host/UTC)'),
    prompt: z.string().optional().describe('Reminder prompt injected into the agent on each fire'),
    schedule: z
      .object({
        cron: z.string().optional(),
        interval: z.string().optional(),
        timezone: z.string().optional(),
        prompt: z.string().optional(),
      })
      .optional()
      .describe('Grouped alternative to the flat cron/interval/timezone/prompt fields'),
    enabled: z.boolean().optional().default(true),
  }),
  outputSchema: z.object({
    taskId: z.string(),
    scheduled: z.boolean(),
    reason: z
      .enum(['INVALID_SCHEDULE', 'SCHEDULING_UNAVAILABLE', 'TASK_NOT_FOUND', 'SCHEDULE_ERROR'])
      .optional(),
    scheduleId: z.string().optional(),
    cron: z.string().optional(),
    nextFireAt: z.number().optional(),
    message: z.string(),
  }),
  execute: async ({ taskId, cron, interval, timezone, prompt, schedule, enabled = true }, context) => {
    const fail = (
      reason: 'INVALID_SCHEDULE' | 'SCHEDULING_UNAVAILABLE' | 'TASK_NOT_FOUND' | 'SCHEDULE_ERROR',
      message: string
    ) => ({ taskId, scheduled: false, reason, message });

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

    const db = await getAppDb();
    if (!db) {
      return fail('SCHEDULE_ERROR', 'No application database connection could be opened.');
    }
    const repo = createTaskRepository(db);

    const task = await repo.getTask(taskId);
    if (!task) {
      return fail('TASK_NOT_FOUND', `Task ${taskId} not found — no schedule was created.`);
    }

    // --- create-or-update (the storage API throws on duplicate ids; the
    // tool is idempotent per task instead) ---------------------------------
    const rawId = `task-${taskId}`;
    const status = enabled ? ('active' as const) : ('paused' as const);
    const reminder =
      reminderPrompt ?? `Reminder: task ${taskId} — "${task.title}" is due for review (cron ${resolvedCron}).`;

    let row: AnySchedule;
    try {
      const existing = await schedules.get(rawId);
      row = existing
        ? await schedules.update(rawId, { cron: resolvedCron, timezone: tz, prompt: reminder, status })
        : await schedules.create({
            id: rawId,
            agentId: AGENT_ID,
            cron: resolvedCron,
            ...(tz !== undefined ? { timezone: tz } : {}),
            prompt: reminder,
            status,
          });
    } catch (error) {
      if (isIdConflictError(error)) {
        try {
          row = await schedules.update(rawId, {
            cron: resolvedCron,
            timezone: tz,
            prompt: reminder,
            status,
          });
        } catch (inner) {
          logger.error('[schedule_task] update after id conflict failed:', inner);
          return fail('SCHEDULE_ERROR', `Failed to update schedule for task ${taskId}.`);
        }
      } else {
        logger.error('[schedule_task] schedules call failed:', error);
        return fail(
          'SCHEDULE_ERROR',
          `Failed to create schedule for task ${taskId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // Record the real row id (normalized `agent_task-…`) on the task row.
    const attached = await repo.attachSchedule(taskId, row.id);
    if (!attached) {
      logger.warn(`[schedule_task] schedule ${row.id} created but task ${taskId} vanished; row not linked.`);
    }

    const event: TaskScheduledEvent = {
      type: 'task.scheduled',
      payload: { taskId, scheduleId: row.id, interval: resolvedCron, timestamp: new Date() },
    };
    await eventBus.publish(event);

    logger.info(`[schedule_task] task ${taskId} → schedule ${row.id} (${resolvedCron}${tz ? ` ${tz}` : ''})`);

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
