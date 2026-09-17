import type { Schedules } from '@mastra/core/schedules';
import type { z } from 'zod';
import { isFail } from '../../../shared/handlers';
import { requireAppDb } from '../../../shared/config/db';
import { logger } from '../../../shared/logger';
import { eventBus, makeEvent } from '../../../shared/events';
import { createTaskRepository } from '../repo';
import { taskScheduledEvent } from '../events';
import { TASK_MANAGEMENT_AGENT_ID, TASK_SCHEDULE_ID_PREFIX } from '../config';
import { syncTaskSchedule } from '../schedule/sync';
import type { scheduleTaskInputSchema } from '../schedule/schemas';
import type { Task } from '../entities/task';
import {
  ScheduleOperationError,
  SchedulingUnavailableError,
  TaskNotFoundError,
  TaskPersistenceUnavailableError,
} from '../handlers/errors';
import { taskFail, taskOk, type TaskResult } from '../handlers/responses';
import { resolveScheduleSpec } from './schedule-spec';

/** Successful outcome of scheduling a reminder for an existing task. */
export interface ScheduledTaskOutcome {
  taskId: string;
  scheduleId: string;
  cron: string;
  nextFireAt?: number;
  enabled: boolean;
}

/** The reminder prompt injected into the agent on each fire (same text as before). */
function buildReminderPrompt(task: Task, cron: string, prompt?: string): string {
  return prompt ?? `Reminder: task ${task.id} — "${task.title}" is due for review (cron ${cron}).`;
}

/**
 * Create-or-update the agent reminder schedule for a task. Extracted from the
 * tool so the fixed ordering (spec → runtime → db → task → sync) is directly
 * unit-testable and the tool stays a thin adapter.
 */
export async function executeScheduleTask(
  input: z.infer<typeof scheduleTaskInputSchema>,
  runtime: { schedules?: Schedules }
): Promise<TaskResult<ScheduledTaskOutcome>> {
  // a. resolve the schedule spec (nested form wins over flat) — pure
  const specResult = resolveScheduleSpec(input);
  if (isFail(specResult)) return taskFail(specResult.error);
  const spec = specResult.unwrap();

  // b. the platform owns scheduling: degrade honestly without the runtime
  const schedules = runtime.schedules;
  if (!schedules) {
    return taskFail(
      new SchedulingUnavailableError(
        'schedule_task needs the Mastra runtime (context.mastra.schedules); it is not available in this execution context.'
      )
    );
  }

  // c. persistence
  let db;
  try {
    db = await requireAppDb('task-schedule');
  } catch {
    return taskFail(
      new TaskPersistenceUnavailableError('No application database connection could be opened.')
    );
  }
  const repo = createTaskRepository(db);

  // d. the task must exist before any schedule row is touched
  const { taskId } = input;
  const task = await repo.getTask(taskId);
  if (!task) {
    return taskFail(new TaskNotFoundError(`Task ${taskId} not found — no schedule was created.`));
  }

  // e. reminder prompt (caller override wins)
  const reminder = buildReminderPrompt(task, spec.cron, spec.prompt);

  // f. create-or-update the schedule (idempotent per task over a throwing API)
  const synced = await syncTaskSchedule(schedules, {
    taskId,
    scheduleId: `${TASK_SCHEDULE_ID_PREFIX}${taskId}`,
    agentId: TASK_MANAGEMENT_AGENT_ID,
    cron: spec.cron,
    timezone: spec.timezone,
    prompt: reminder,
    enabled: spec.enabled,
  });
  if (!synced.ok) return taskFail(new ScheduleOperationError(synced.message));
  const row = synced.row;

  // g. link the normalized row id back onto the task
  const attached = await repo.attachSchedule(taskId, row.id);
  if (!attached) {
    logger.warn(
      `[schedule_task] schedule ${row.id} created but task ${taskId} vanished; row not linked.`
    );
  }

  // h. announce AFTER the commit
  await eventBus.publish(
    makeEvent(taskScheduledEvent, {
      taskId,
      scheduleId: row.id,
      interval: spec.cron,
      timestamp: new Date(),
    })
  );

  logger.info(
    `[schedule_task] task ${taskId} → schedule ${row.id} (${spec.cron}${
      spec.timezone ? ` ${spec.timezone}` : ''
    })`
  );

  return taskOk({
    taskId,
    scheduleId: row.id,
    cron: spec.cron,
    nextFireAt: row.nextFireAt,
    enabled: spec.enabled,
  });
}
