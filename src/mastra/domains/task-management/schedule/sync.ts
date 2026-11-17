import type { AnySchedule, Schedules } from '@mastra/core/schedules';

/** The storage API throws this code when a schedule id already exists. */
export function isIdConflictError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SCHEDULES_ID_EXISTS'
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

/** Create the schedule, or update the existing one for this task (idempotent per task). */
export async function syncTaskSchedule(
  schedules: Schedules,
  input: SyncTaskScheduleInput
): Promise<AnySchedule> {
  const { scheduleId, cron, timezone, prompt, enabled } = input;
  const status = enabled ? ('active' as const) : ('paused' as const);
  const patch = { cron, timezone, prompt, status };

  try {
    const existing = await schedules.get(scheduleId);
    if (existing) return await schedules.update(scheduleId, patch);
    return await schedules.create({
      id: scheduleId,
      agentId: input.agentId,
      cron,
      ...(timezone !== undefined ? { timezone } : {}),
      prompt,
      status,
    });
  } catch (error) {
    if (!isIdConflictError(error)) throw error;
    return await schedules.update(scheduleId, patch);
  }
}
