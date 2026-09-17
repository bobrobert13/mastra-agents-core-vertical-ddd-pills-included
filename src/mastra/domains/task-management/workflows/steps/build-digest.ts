import { createStep } from '@mastra/core/workflows';
import { logger } from '../../../../shared/logger';
import { eventBus, makeEvent } from '../../../../shared/events';
import type { Task } from '../../entities/task';
import { tasksDigestReadyEvent } from '../../events';
import { buildDigestInputSchema, digestOutputSchema, type DigestWindow } from '../schemas';

/** Step 2 core (pure): markdown digest over the collected rows. */
export function buildDigest(
  window: DigestWindow,
  open: Task[]
): {
  date: string;
  openCount: number;
  lines: string[];
} {
  const lines: string[] = [`## Daily digest — ${window.date} (resource ${window.resourceId})`];
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

export const buildDigestStep = createStep({
  id: 'build-digest',
  description: 'Compose the markdown digest and publish tasks.digest.ready',
  inputSchema: buildDigestInputSchema,
  outputSchema: digestOutputSchema,
  execute: async ({ inputData }) => {
    const open: Task[] = inputData.open.map(t => ({
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

    const event = makeEvent(tasksDigestReadyEvent, {
      date: digest.date,
      resourceId: inputData.resourceId,
      openCount: digest.openCount,
      lines: digest.lines,
      timestamp: new Date(),
    });
    await eventBus.publish(event);

    return digest;
  },
});
