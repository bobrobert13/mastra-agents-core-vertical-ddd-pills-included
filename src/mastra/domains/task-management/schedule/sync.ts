import type { AnySchedule, Schedules } from '@mastra/core/schedules';
import { logger } from '../../../shared/logger';

/**
 * Isolated create-or-update for a task's reminder schedule. The storage API is
 * NOT idempotent (it throws on duplicate ids), so the tool layer wraps it in
 * the get → update-or-create dance and recovers from a create() race.
 */

/** The storage API throws this code when a schedule id already exists. */
export function isIdConflictError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'SCHEDULES_ID_EXISTS'
  );
}

export interface SyncTaskScheduleInput {
  taskId: string;
  /** Raw id (`task-<taskId>`) — the Schedules service normalizes it to `agent_task-<slug>`. */
  scheduleId: string;
  agentId: string;
  cron: string;
  timezone?: string;
  prompt: string;
  enabled: boolean;
}

export type SyncTaskScheduleResult =
  | { ok: true; row: AnySchedule }
  | { ok: false; message: string };

/** Create the schedule, or update the existing one for this task (idempotent per task). */
export async function syncTaskSchedule(
  schedules: Schedules,
  input: SyncTaskScheduleInput
): Promise<SyncTaskScheduleResult> {
  const { scheduleId, cron, timezone, prompt, enabled } = input;
  const status = enabled ? ('active' as const) : ('paused' as const);
  const patch = { cron, timezone, prompt, status };

  try {
    const existing = await schedules.get(scheduleId);
    const row = existing
      ? await schedules.update(scheduleId, patch)
      : await schedules.create({
          id: scheduleId,
          agentId: input.agentId,
          cron,
          ...(timezone !== undefined ? { timezone } : {}),
          prompt,
          status,
        });
    return { ok: true, row };
  } catch (error) {
    if (isIdConflictError(error)) {
      try {
        const row = await schedules.update(scheduleId, patch);
        return { ok: true, row };
      } catch (inner) {
        logger.error('[schedule_task] update after id conflict failed:', inner);
        return { ok: false, message: `Failed to update schedule for task ${input.taskId}.` };
      }
    }
    logger.error('[schedule_task] schedules call failed:', error);
    return {
      ok: false,
      message: `Failed to create schedule for task ${input.taskId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
