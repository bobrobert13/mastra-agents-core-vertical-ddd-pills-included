import { createStep } from '@mastra/core/workflows';
import { requireAppDb } from '../../../../shared/config/db';
import { createTaskRepository } from '../../repo';
import type { TaskRepository } from '../../repo';
import type { Task } from '../../entities/task';
import {
  collectOpenTasksInputSchema,
  collectOpenTasksOutputSchema,
  type DigestWindow,
} from '../schemas';

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

export const collectOpenTasksStep = createStep({
  id: 'collect-open-tasks',
  description: 'Read open (non-completed) tasks from app_tasks — deterministic, no LLM',
  inputSchema: collectOpenTasksInputSchema,
  outputSchema: collectOpenTasksOutputSchema,
  execute: async ({ inputData }) => {
    const db = await requireAppDb('daily-digest');
    const repo = createTaskRepository(db);
    const window: DigestWindow = {
      date: inputData.date ?? new Date().toISOString().slice(0, 10),
      resourceId: inputData.resourceId,
    };
    const { open } = await collectOpenTasks(repo, window);
    return {
      date: window.date,
      resourceId: window.resourceId,
      open: open.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      })),
    };
  },
});
