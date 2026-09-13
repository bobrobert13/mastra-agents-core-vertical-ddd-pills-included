import { createWorkflow, createStep } from '@mastra/core/workflows';
import { MastraError, ErrorDomain, ErrorCategory } from '@mastra/core/error';
import { z } from 'zod';
import { getAppDb } from '../../../shared/config/db';
import { logger } from '../../../shared/logger';
import { eventBus } from '../../../shared/events';
import { createTaskRepository } from '../repo';
import type { TaskRepository } from '../repo';
import type { Task } from '../entities/task';
import type { TasksDigestReadyEvent } from '../events';

/**
 * daily-digest — LLM-free by design so it fires in zero-config /
 * provider-less mode (spec 05 §3.5). Declares a single schedule → row id
 * `wf_daily-digest`; scheduled fires and manual `createRun()` share the
 * public API. LibSQL satisfies the evented-engine concurrency requirement
 * (spec 05 §3.6).
 *
 * Register in `src/mastra/index.ts` `workflows` map (unregistered = invisible).
 */

export interface DigestWindow {
  date: string;
  resourceId: string;
}

/** Step 1 core (exported for deterministic unit tests): open = status ≠ completed. */
export async function collectOpenTasks(
  repo: TaskRepository,
  window: DigestWindow
): Promise<{ window: DigestWindow; open: Task[] }> {
  const open = await repo.listTasks({
    resourceId: window.resourceId,
    excludeStatus: 'completed',
    limit: 100,
  });
  return { window, open };
}

/** Step 2 core (pure): markdown digest over the collected rows. */
export function buildDigest(window: DigestWindow, open: Task[]): {
  date: string;
  openCount: number;
  lines: string[];
} {
  const lines: string[] = [
    `## Daily digest — ${window.date} (resource ${window.resourceId})`,
  ];
  if (open.length === 0) {
    lines.push('_No open tasks._');
  } else {
    for (const task of open) {
      const due = task.dueDate ? ` · due ${task.dueDate.toISOString().slice(0, 10)}` : '';
      lines.push(`- [${task.status}] ${task.title} (${task.priority})${due}`);
    }
  }
  return { date: window.date, openCount: open.length, lines };
}

export const collectOpenTasksStep = createStep({
  id: 'collect-open-tasks',
  description: 'Read open (non-completed) tasks from app_tasks — deterministic, no LLM',
  inputSchema: z.object({
    resourceId: z.string(),
    date: z.string().optional(),
  }),
  outputSchema: z.object({
    date: z.string(),
    resourceId: z.string(),
    open: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        priority: z.string(),
        dueDate: z.string().nullable(),
      })
    ),
  }),
  execute: async ({ inputData }) => {
    const db = await getAppDb();
    if (!db) {
      throw new MastraError({
        id: 'TASK_PERSISTENCE_UNAVAILABLE',
        domain: ErrorDomain.MASTRA_WORKFLOW,
        category: ErrorCategory.SYSTEM,
        text: 'daily-digest: no application database connection could be opened',
      });
    }
    const repo = createTaskRepository(db);
    const window: DigestWindow = {
      date: inputData.date ?? new Date().toISOString().slice(0, 10),
      resourceId: inputData.resourceId,
    };
    const { open } = await collectOpenTasks(repo, window);
    return {
      date: window.date,
      resourceId: window.resourceId,
      open: open.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      })),
    };
  },
});

export const buildDigestStep = createStep({
  id: 'build-digest',
  description: 'Compose the markdown digest and publish tasks.digest.ready',
  inputSchema: z.object({
    date: z.string(),
    resourceId: z.string(),
    open: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        priority: z.string(),
        dueDate: z.string().nullable(),
      })
    ),
  }),
  outputSchema: z.object({
    date: z.string(),
    openCount: z.number(),
    lines: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    const open: Task[] = inputData.open.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status as Task['status'],
      priority: t.priority as Task['priority'],
      dueDate: t.dueDate ? new Date(t.dueDate) : undefined,
      createdAt: new Date(inputData.date),
      updatedAt: new Date(inputData.date),
    }));
    const digest = buildDigest({ date: inputData.date, resourceId: inputData.resourceId }, open);

    logger.info(`[daily-digest] ${digest.openCount} open task(s) for ${inputData.date}`);

    const event: TasksDigestReadyEvent = {
      type: 'tasks.digest.ready',
      payload: {
        date: digest.date,
        resourceId: inputData.resourceId,
        openCount: digest.openCount,
        lines: digest.lines,
        timestamp: new Date(),
      },
    };
    await eventBus.publish(event);

    return digest;
  },
});

export const dailyDigestWorkflow = createWorkflow({
  id: 'daily-digest',
  description: 'Cron-fired digest of open tasks (proves the scheduler path)',
  inputSchema: z.object({
    resourceId: z.string().default('default'),
    date: z.string().optional(),
  }),
  outputSchema: z.object({
    date: z.string(),
    openCount: z.number(),
    lines: z.array(z.string()),
  }),
  schedule: {
    // single form → declarative row id `wf_daily-digest` (boot sync)
    cron: '0 9 * * *',
    timezone: 'UTC', // explicit — host-tz default flagged in spec
    inputData: { resourceId: 'default' },
  },
})
  .then(collectOpenTasksStep)
  .then(buildDigestStep)
  .commit();
