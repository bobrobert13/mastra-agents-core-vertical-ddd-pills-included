// Mastra tools: https://mastra.ai/docs/agents/tools
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { requireAppDb } from '../../../shared/config/db';
import { TASK_MANAGEMENT_AGENT_ID, TASK_SCHEDULE_ID_PREFIX } from '../config';
import { createTaskRepository } from '../repo';
import { intervalToCron } from '../schedule/interval';
import { syncTaskSchedule } from '../schedule/sync';

const inputSchema = z.object({
  taskId: z.string().describe('Task ID to schedule a reminder for'),
  cron: z.string().optional().describe('Cron expression, e.g. "0 9 * * *" (daily 9am)'),
  interval: z
    .string()
    .optional()
    .describe('Back-compat interval, e.g. "15m", "1h", "2d" — converted to a cron'),
  timezone: z.string().optional().describe('IANA timezone, e.g. "Europe/Madrid"'),
  prompt: z.string().optional().describe('Reminder prompt injected into the agent on each fire'),
  enabled: z.boolean().optional().default(true),
});

const outputSchema = z.object({
  taskId: z.string(),
  scheduled: z.boolean(),
  reason: z.enum(['INVALID_SCHEDULE', 'NOT_FOUND', 'UNAVAILABLE', 'ERROR']).optional(),
  scheduleId: z.string().optional(),
  cron: z.string().optional(),
  nextFireAt: z.number().optional(),
  message: z.string(),
});

export const scheduleTaskTool = createTool({
  id: 'task-schedule',
  description:
    'Schedule a recurring reminder prompt for an existing task (real persisted cron schedule on the agent)',
  inputSchema,
  outputSchema,
  execute: async (input, context) => {
    const cron = input.cron ?? (input.interval ? intervalToCron(input.interval) : null);
    if (!cron) {
      return {
        taskId: input.taskId,
        scheduled: false,
        reason: 'INVALID_SCHEDULE' as const,
        message: 'Provide a cron expression or an interval like "15m", "1h" or "2d".',
      };
    }

    const db = await requireAppDb('task-schedule');
    const repo = createTaskRepository(db);
    const task = await repo.getTask(input.taskId);
    if (!task) {
      return {
        taskId: input.taskId,
        scheduled: false,
        reason: 'NOT_FOUND' as const,
        message: `Task ${input.taskId} not found.`,
      };
    }

    const schedules = context?.mastra?.schedules;
    if (!schedules) {
      return {
        taskId: input.taskId,
        scheduled: false,
        reason: 'UNAVAILABLE' as const,
        message: 'Scheduling is unavailable in this runtime.',
      };
    }

    const scheduleId = `${TASK_SCHEDULE_ID_PREFIX}${input.taskId}`;
    try {
      const row = await syncTaskSchedule(schedules, {
        taskId: input.taskId,
        scheduleId,
        agentId: TASK_MANAGEMENT_AGENT_ID,
        cron,
        timezone: input.timezone,
        prompt: input.prompt ?? `Reminder for task: ${task.title}`,
        enabled: input.enabled ?? true,
      });
      await repo.attachSchedule(input.taskId, row.id);

      return {
        taskId: input.taskId,
        scheduled: true,
        scheduleId: row.id,
        cron: row.cron,
        nextFireAt: row.nextFireAt,
        message: `Reminder schedule ${row.id} is ${row.status} for task ${input.taskId} (cron ${row.cron}).`,
      };
    } catch (error) {
      return {
        taskId: input.taskId,
        scheduled: false,
        reason: 'ERROR' as const,
        message: `Failed to schedule task ${input.taskId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  },
});
