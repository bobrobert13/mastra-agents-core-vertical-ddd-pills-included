import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const createTaskTool = createTool({
  id: 'task-create',
  description: 'Create a new task',
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
    createdAt: z.string(),
  }),
  execute: async ({ title, description: _description, priority: _priority = 'medium', dueDate: _dueDate }) => {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    return {
      taskId,
      title,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  },
});
