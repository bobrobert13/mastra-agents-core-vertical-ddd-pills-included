import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const updateTaskTool = createTool({
  id: 'task-update',
  description: 'Update an existing task',
  inputSchema: z.object({
    taskId: z.string().describe('Task ID'),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['pending', 'in-progress', 'completed']).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  }),
  outputSchema: z.object({
    taskId: z.string(),
    updated: z.boolean(),
    message: z.string(),
  }),
  execute: async ({
    taskId,
    title: _title,
    description: _description,
    status: _status,
    priority: _priority,
  }) => {
    // In a real implementation, this would update in database
    return {
      taskId,
      updated: true,
      message: `Task ${taskId} updated successfully`,
    };
  },
});
