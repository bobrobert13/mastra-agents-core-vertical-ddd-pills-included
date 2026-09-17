import { z } from 'zod';

/**
 * `schedule_task` tool I/O schemas (spec 05 §3.4).
 *
 * Extracted so the tool body stays a thin orchestrator and the typed failure
 * `reason` enum has a single source shared by the output schema and the tool.
 */

/** Typed, non-fake failure outcomes returned by the tool. */
export const scheduleFailureReasonSchema = z.enum([
  'INVALID_SCHEDULE',
  'SCHEDULING_UNAVAILABLE',
  'TASK_NOT_FOUND',
  'SCHEDULE_ERROR',
]);

export type ScheduleFailureReason = z.infer<typeof scheduleFailureReasonSchema>;

export const scheduleTaskInputSchema = z.object({
  taskId: z.string().describe('Task ID to schedule a reminder for'),
  cron: z.string().optional().describe('Cron expression, e.g. "0 9 * * *" (daily 9am)'),
  interval: z
    .string()
    .optional()
    .describe('Back-compat interval, e.g. "15m", "1h", "2d" — converted to a cron'),
  timezone: z
    .string()
    .optional()
    .describe('IANA timezone, e.g. "Europe/Madrid" (default: host/UTC)'),
  prompt: z.string().optional().describe('Reminder prompt injected into the agent on each fire'),
  schedule: z
    .object({
      cron: z.string().optional(),
      interval: z.string().optional(),
      timezone: z.string().optional(),
      prompt: z.string().optional(),
    })
    .optional()
    .describe('Grouped alternative to the flat cron/interval/timezone/prompt fields'),
  enabled: z.boolean().optional().default(true),
});

export const scheduleTaskOutputSchema = z.object({
  taskId: z.string(),
  scheduled: z.boolean(),
  reason: scheduleFailureReasonSchema.optional(),
  scheduleId: z.string().optional(),
  cron: z.string().optional(),
  nextFireAt: z.number().optional(),
  message: z.string(),
});
