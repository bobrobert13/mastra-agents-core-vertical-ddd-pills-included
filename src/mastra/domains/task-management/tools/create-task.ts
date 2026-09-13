import { createTool } from '@mastra/core/tools';
import { MastraError, ErrorDomain, ErrorCategory } from '@mastra/core/error';
import { z } from 'zod';
import { getAppDb } from '../../../shared/config/db';
import { logger } from '../../../shared/logger';
import { eventBus } from '../../../shared/events';
import { createTaskRepository } from '../repo';
import type { TaskCreatedEvent } from '../events';

export const createTaskTool = createTool({
  id: 'task-create',
  description: 'Create a new task (persisted to the app_tasks table)',
  inputSchema: z.object({
    title: z.string().describe('Task title'),
    description: z.string().optional().describe('Task description'),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    dueDate: z.string().optional().describe('Due date in ISO format'),
  }),
  outputSchema: z.object({
    taskId: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string(),
    dueDate: z.string().optional(),
    createdAt: z.string(),
  }),
  execute: async ({ title, description, priority = 'medium', dueDate }, context) => {
    const db = await getAppDb();
    if (!db) {
      throw new MastraError({
        id: 'TASK_PERSISTENCE_UNAVAILABLE',
        domain: ErrorDomain.TOOL,
        category: ErrorCategory.SYSTEM,
        text: 'create_task: no application database connection could be opened (check DATABASE_URL/LIBSQL_URL)',
      });
    }

    const repo = createTaskRepository(db);
    // ToolExecutionContext has no top-level resourceId — conversation
    // identity arrives on context.agent (spec 05 §3.0).
    const resourceId = context?.agent?.resourceId ?? 'default';

    const task = await repo.createTask({ title, description, priority, dueDate, resourceId });

    // Emit AFTER the commit — a failed insert must not announce a task.
    const event: TaskCreatedEvent = {
      type: 'task.created',
      payload: {
        taskId: task.id,
        title: task.title,
        priority: task.priority,
        timestamp: task.createdAt,
      },
    };
    await eventBus.publish(event);

    logger.info(`[create_task] persisted task ${task.id} (resource ${resourceId})`);

    return {
      taskId: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      ...(task.dueDate ? { dueDate: task.dueDate.toISOString() } : {}),
      createdAt: task.createdAt.toISOString(),
    };
  },
});
