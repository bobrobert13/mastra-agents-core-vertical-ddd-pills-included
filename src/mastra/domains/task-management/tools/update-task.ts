import { createTool } from '@mastra/core/tools';
import { MastraError, ErrorDomain, ErrorCategory } from '@mastra/core/error';
import { z } from 'zod';
import { getAppDb } from '../../../shared/config/db';
import { logger } from '../../../shared/logger';
import { eventBus } from '../../../shared/events';
import { createTaskRepository } from '../repo';
import type { TaskUpdatedEvent, TaskCompletedEvent } from '../events';

export const updateTaskTool = createTool({
  id: 'task-update',
  description: 'Update an existing task (guarded write with optimistic locking)',
  inputSchema: z.object({
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
  }),
  outputSchema: z.object({
    taskId: z.string(),
    updated: z.boolean(),
    reason: z.enum(['NOT_FOUND', 'CONFLICT']).optional(),
    message: z.string(),
    task: z
      .object({
        status: z.string(),
        priority: z.string(),
        version: z.number(),
        updatedAt: z.string(),
      })
      .optional(),
  }),
  execute: async ({ taskId, title, description, status, priority, expectedVersion }) => {
    const db = await getAppDb();
    if (!db) {
      throw new MastraError({
        id: 'TASK_PERSISTENCE_UNAVAILABLE',
        domain: ErrorDomain.TOOL,
        category: ErrorCategory.SYSTEM,
        text: 'update_task: no application database connection could be opened (check DATABASE_URL/LIBSQL_URL)',
      });
    }
    const repo = createTaskRepository(db);

    const current = await repo.getTask(taskId);
    if (!current) {
      return {
        taskId,
        updated: false,
        reason: 'NOT_FOUND' as const,
        message: `Task ${taskId} not found — nothing was updated.`,
      };
    }

    const changes: Record<string, unknown> = {};
    if (title !== undefined) changes.title = title;
    if (description !== undefined) changes.description = description;
    if (status !== undefined) changes.status = status;
    if (priority !== undefined) changes.priority = priority;

    // Last-writer-wins is explicit: guarded UPDATE against the version we
    // just read (or the caller-supplied one) so a stale write reports
    // CONFLICT instead of silently corrupting the row (Scenario 5).
    const updatedRow = await repo.updateTask(taskId, {
      ...changes,
      expectVersion: expectedVersion ?? current.version,
    });

    if (!updatedRow) {
      const fresh = await repo.getTask(taskId);
      return {
        taskId,
        updated: false,
        reason: 'CONFLICT' as const,
        message: `Task ${taskId} changed since it was read (expected version ${
          expectedVersion ?? current.version
        }); re-read and retry.`,
        ...(fresh
          ? {
              task: {
                status: fresh.status,
                priority: fresh.priority,
                version: fresh.version ?? 0,
                updatedAt: fresh.updatedAt.toISOString(),
              },
            }
          : {}),
      };
    }

    const event: TaskUpdatedEvent = {
      type: 'task.updated',
      payload: { taskId, changes, timestamp: updatedRow.updatedAt },
    };
    await eventBus.publish(event);

    if (status === 'completed' && current.status !== 'completed') {
      const completed: TaskCompletedEvent = {
        type: 'task.completed',
        payload: { taskId, completedAt: updatedRow.updatedAt },
      };
      await eventBus.publish(completed);
    }

    logger.info(`[update_task] task ${taskId} updated to version ${updatedRow.version}`);

    return {
      taskId,
      updated: true,
      message: `Task ${taskId} updated successfully (version ${updatedRow.version}).`,
      task: {
        status: updatedRow.status,
        priority: updatedRow.priority,
        version: updatedRow.version ?? 0,
        updatedAt: updatedRow.updatedAt.toISOString(),
      },
    };
  },
});
