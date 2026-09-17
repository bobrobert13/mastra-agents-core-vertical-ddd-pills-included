import { AppResult } from '../../../shared/handlers';
import type { ScheduleFailureReason } from '../schedule/schemas';
import {
  InvalidScheduleError,
  SchedulingUnavailableError,
  TaskConflictError,
  TaskNotFoundError,
  type TaskManagementError,
} from './errors';

/** Result of a task-management operation: a value or a typed domain failure. */
export type TaskResult<T> = AppResult<T, TaskManagementError>;

export const taskOk = <T>(value: T): TaskResult<T> => AppResult.ok<T, TaskManagementError>(value);

export const taskFail = <T>(error: TaskManagementError): TaskResult<T> =>
  AppResult.fail<T, TaskManagementError>(error);

/** Map a domain failure onto `update_task`'s honest `reason` enum. */
export function toUpdateFailureReason(
  error: TaskManagementError
): 'NOT_FOUND' | 'CONFLICT' | undefined {
  if (error instanceof TaskNotFoundError) return 'NOT_FOUND';
  if (error instanceof TaskConflictError) return 'CONFLICT';
  return undefined;
}

/** Map a domain failure onto `schedule_task`'s `ScheduleFailureReason` enum. */
export function toScheduleFailureReason(error: TaskManagementError): ScheduleFailureReason {
  if (error instanceof InvalidScheduleError) return 'INVALID_SCHEDULE';
  if (error instanceof SchedulingUnavailableError) return 'SCHEDULING_UNAVAILABLE';
  if (error instanceof TaskNotFoundError) return 'TASK_NOT_FOUND';
  return 'SCHEDULE_ERROR';
}
