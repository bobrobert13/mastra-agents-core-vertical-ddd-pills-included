// Mastra tools: https://mastra.ai/docs/agents/tools
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { requireAppDb } from '../../../shared/config/db';
import { createTaskRepository } from '../repo';

const inputSchema = z.object({
  taskId: z.string().describe('Task ID to update'),
  title: z.string().optional().describe('New task title'),
  description: z.string().optional().describe('New task description'),
  status: z.enum(['pending', 'in-progress', 'completed']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});

export const updateTaskTool = createTool({
  id: 'task-update',
  description: 'Update an existing task',
  inputSchema,
  outputSchema: z.object({
    taskId: z.string(),
    updated: z.boolean(),
    reason: z.literal('NOT_FOUND').optional(),
    message: z.string(),
    task: z
      .object({
        status: z.string(),
        priority: z.string(),
        updatedAt: z.string(),
      })
      .optional(),
  }),
  execute: async ({ taskId, ...patch }) => {
    const db = await requireAppDb('task-update');
    const repo = createTaskRepository(db);

    if (!(await repo.getTask(taskId))) {
      return { taskId, updated: false, reason: 'NOT_FOUND' as const, message: `Task ${taskId} not found.` };
    }

    const task = await repo.updateTask(taskId, patch);
    if (!task) {
      return { taskId, updated: false, reason: 'NOT_FOUND' as const, message: `Task ${taskId} not found.` };
    }

    return {
      taskId,
      updated: true,
      message: `Task ${taskId} updated successfully.`,
      task: {
        status: task.status,
        priority: task.priority,
        updatedAt: task.updatedAt.toISOString(),
      },
    };
  },
});
