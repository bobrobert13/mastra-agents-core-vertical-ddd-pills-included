import { z } from 'zod';
import { requireAppDb } from '../../../shared/config/db';
import { logger } from '../../../shared/logger';
import { eventBus, makeEvent } from '../../../shared/events';
import { createTaskRepository } from '../repo';
import { taskCompletedEvent, taskUpdatedEvent } from '../events';
import type { Task } from '../entities/task';
import {
  TaskConflictError,
  TaskNotFoundError,
  TaskPersistenceUnavailableError,
} from '../handlers/errors';
import { taskFail, taskOk, type TaskResult } from '../handlers/responses';

/** `update_task` input — the single source for the tool's inputSchema and types. */
export const updateTaskInputSchema = z.object({
  taskId: z.string().describe('Task ID'),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['pending', 'in-progress', 'completed']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  expectedVersion: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optimistic lock: fail with CONFLICT if the row moved past this version'),
});

export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

/** Only the fields the caller actually supplied become a patch (pure). */
export function buildTaskChanges(
  input: Pick<UpdateTaskInput, 'title' | 'description' | 'status' | 'priority'>
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (input.title !== undefined) changes.title = input.title;
  if (input.description !== undefined) changes.description = input.description;
  if (input.status !== undefined) changes.status = input.status;
  if (input.priority !== undefined) changes.priority = input.priority;
  return changes;
}

/**
 * Guarded write: read → compare-and-swap → emit. Extracted from the tool so
 * the NOT_FOUND / CONFLICT / success branches are directly assertable.
 */
export async function executeTaskUpdate(input: UpdateTaskInput): Promise<TaskResult<Task>> {
  const { taskId, status, expectedVersion } = input;

  let db;
  try {
    db = await requireAppDb('task-update');
  } catch {
    return taskFail(
      new TaskPersistenceUnavailableError('No application database connection could be opened.')
    );
  }
  const repo = createTaskRepository(db);

  const current = await repo.getTask(taskId);
  if (!current) {
    return taskFail(new TaskNotFoundError(`Task ${taskId} not found — nothing was updated.`));
  }

  const changes = buildTaskChanges(input);
  // Last-writer-wins is explicit: guarded UPDATE against the version we just
  // read (or the caller-supplied one) so a stale write reports CONFLICT.
  const updatedRow = await repo.updateTask(taskId, {
    ...changes,
    expectVersion: expectedVersion ?? current.version,
  });

  if (!updatedRow) {
    const fresh = await repo.getTask(taskId);
    return taskFail(
      new TaskConflictError(
        `Task ${taskId} changed since it was read (expected version ${
          expectedVersion ?? current.version
        }); re-read and retry.`,
        fresh ?? undefined
      )
    );
  }

  await eventBus.publish(
    makeEvent(taskUpdatedEvent, { taskId, changes, timestamp: updatedRow.updatedAt })
  );

  if (status === 'completed' && current.status !== 'completed') {
    await eventBus.publish(
      makeEvent(taskCompletedEvent, { taskId, completedAt: updatedRow.updatedAt })
    );
  }

  logger.info(`[update_task] task ${taskId} updated to version ${updatedRow.version}`);
  return taskOk(updatedRow);
}
