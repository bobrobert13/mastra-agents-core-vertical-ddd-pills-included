// Mastra workflows: https://mastra.ai/docs/workflows/overview
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { requireAppDb } from '../../../shared/config/db';
import { logger } from '../../../shared/logger';
import { DIGEST_SCHEDULE_CRON, DIGEST_SCHEDULE_TIMEZONE } from '../config';
import { createTaskRepository } from '../repo';

const digestInputSchema = z.object({
  resourceId: z.string().default('default'),
  date: z.string().optional(),
});

const openTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  dueDate: z.string().nullable(),
});

const collectOutputSchema = z.object({
  date: z.string(),
  resourceId: z.string(),
  open: z.array(openTaskSchema),
});

const digestOutputSchema = z.object({
  date: z.string(),
  openCount: z.number(),
  lines: z.array(z.string()),
});

const collectOpenTasksStep = createStep({
  id: 'collect-open-tasks',
  description: 'Read open (non-completed) tasks from app_tasks — deterministic, no LLM',
  inputSchema: digestInputSchema,
  outputSchema: collectOutputSchema,
  execute: async ({ inputData }) => {
    const db = await requireAppDb('daily-digest');
    const repo = createTaskRepository(db);
    const date = inputData.date ?? new Date().toISOString().slice(0, 10);
    const open = await repo.listTasks({
      resourceId: inputData.resourceId,
      excludeStatus: 'completed',
      limit: 100,
    });

    return {
      date,
      resourceId: inputData.resourceId,
      open: open.map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      })),
    };
  },
});

const buildDigestStep = createStep({
  id: 'build-digest',
  description: 'Compose the markdown digest',
  inputSchema: collectOutputSchema,
  outputSchema: digestOutputSchema,
  execute: async ({ inputData }) => {
    const lines: string[] = [
      `## Daily digest — ${inputData.date} (resource ${inputData.resourceId})`,
    ];
    if (inputData.open.length === 0) {
      lines.push('_No open tasks._');
    } else {
      for (const task of inputData.open) {
        const due = task.dueDate ? ` · due ${task.dueDate.slice(0, 10)}` : '';
        lines.push(`- [${task.status}] ${task.title} (${task.priority})${due}`);
      }
    }

    logger.info(`[daily-digest] ${inputData.open.length} open task(s) for ${inputData.date}`);
    return { date: inputData.date, openCount: inputData.open.length, lines };
  },
});

export const dailyDigestWorkflow = createWorkflow({
  id: 'daily-digest',
  description: 'Cron-fired digest of open tasks (proves the scheduler path)',
  inputSchema: digestInputSchema,
  outputSchema: digestOutputSchema,
  schedule: {
    cron: DIGEST_SCHEDULE_CRON,
    timezone: DIGEST_SCHEDULE_TIMEZONE,
    inputData: { resourceId: 'default' },
  },
})
  .then(collectOpenTasksStep)
  .then(buildDigestStep)
  .commit();
