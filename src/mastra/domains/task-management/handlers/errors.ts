import { AppError, isPersistenceUnavailable, toAppError } from '../../../shared/handlers';
import type { Task } from '../entities/task';

/**
 * Concrete error hierarchy for the task-management domain. Every failure is a
 * `TaskManagementError` (an `AppError` tagged `domain: 'task-management'`), so
 * the tool layer adapts one typed value instead of inventing reason strings.
 */
export abstract class TaskManagementError extends AppError {
  readonly domain = 'task-management' as const;
}

/** The application database could not be opened — degrade, never crash. */
export class TaskPersistenceUnavailableError extends TaskManagementError {
  readonly code = 'PERSISTENCE_UNAVAILABLE' as const;
  constructor(message: string) {
    super(message, { kind: 'unavailable' });
  }
}

/** No task row exists for the requested id. */
export class TaskNotFoundError extends TaskManagementError {
  readonly code = 'TASK_NOT_FOUND' as const;
  constructor(message: string) {
    super(message, { kind: 'not_found' });
  }
}

/** The optimistic-lock version moved; carries the fresh row for the caller. */
export class TaskConflictError extends TaskManagementError {
  readonly code = 'TASK_CONFLICT' as const;
  readonly current?: Task;
  constructor(message: string, current?: Task) {
    super(message, { kind: 'conflict' });
    this.current = current;
  }
}

/** Neither a cron nor a parseable interval was supplied. */
export class InvalidScheduleError extends TaskManagementError {
  readonly code = 'INVALID_SCHEDULE' as const;
  constructor(message: string) {
    super(message, { kind: 'validation' });
  }
}

/** The Mastra scheduling runtime is not reachable in this execution context. */
export class SchedulingUnavailableError extends TaskManagementError {
  readonly code = 'SCHEDULING_UNAVAILABLE' as const;
  constructor(message: string) {
    super(message, { kind: 'unavailable' });
  }
}

/** The schedules service rejected the create-or-update call. */
export class ScheduleOperationError extends TaskManagementError {
  readonly code = 'SCHEDULE_ERROR' as const;
  constructor(message: string) {
    super(message, { kind: 'internal' });
  }
}

/** Catch-all for a throw that is not already a typed domain failure. */
export class UnexpectedTaskManagementError extends TaskManagementError {
  readonly code = 'TASK_MANAGEMENT_ERROR' as const;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause, kind: 'internal' });
  }
}

/**
 * Normalize any throw into the domain hierarchy: pass a `TaskManagementError`
 * through, translate a persistence outage, and wrap everything else.
 */
export function toTaskManagementError(error: unknown): TaskManagementError {
  if (error instanceof TaskManagementError) return error;
  if (isPersistenceUnavailable(error)) {
    return new TaskPersistenceUnavailableError(
      'No application database connection could be opened.'
    );
  }
  return toAppError(error, cause => new UnexpectedTaskManagementError(cause));
}
