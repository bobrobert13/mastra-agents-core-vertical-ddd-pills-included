import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const scheduleTaskTool = createTool({
  id: 'task-schedule',
  description: 'Schedule a task to run at specific intervals',
  inputSchema: z.object({
    taskId: z.string().describe('Task ID to schedule'),
    interval: z.string().describe('Interval (e.g., "1m", "5m", "1h")'),
    enabled: z.boolean().optional().default(true),
  }),
  outputSchema: z.object({
    scheduleId: z.string(),
    taskId: z.string(),
    interval: z.string(),
    enabled: z.boolean(),
  }),
  execute: async ({ taskId, interval, enabled = true }) => {
    const scheduleId = `schedule_${Date.now()}`;

    return {
      scheduleId,
      taskId,
      interval,
      enabled,
    };
  },
});
