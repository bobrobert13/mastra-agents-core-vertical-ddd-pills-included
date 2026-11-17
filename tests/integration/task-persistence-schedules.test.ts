import type { Schedules } from '@mastra/core/schedules';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createTaskTool as createTaskToolType } from '../../src/mastra/domains/task-management/tools/create-task';
import type { updateTaskTool as updateTaskToolType } from '../../src/mastra/domains/task-management/tools/update-task';
import type { scheduleTaskTool as scheduleTaskToolType } from '../../src/mastra/domains/task-management/tools/schedule-task';
import type { resetAppDb as resetAppDbType } from '../../src/mastra/shared/config/db';
import { callTool } from '../helpers/call-tool';

type TaskTools = {
  createTaskTool: typeof createTaskToolType;
  updateTaskTool: typeof updateTaskToolType;
  scheduleTaskTool: typeof scheduleTaskToolType;
  resetAppDb: typeof resetAppDbType;
};

let tools: TaskTools;

// Dynamic imports on purpose: LIBSQL_URL must be set before the DB singleton resolves.
beforeAll(async () => {
  process.env.LIBSQL_URL = ':memory:';
  delete process.env.DATABASE_URL;
  vi.resetModules();
  const [create, update, schedule, db] = await Promise.all([
    import('../../src/mastra/domains/task-management/tools/create-task'),
    import('../../src/mastra/domains/task-management/tools/update-task'),
    import('../../src/mastra/domains/task-management/tools/schedule-task'),
    import('../../src/mastra/shared/config/db'),
  ]);
  tools = {
    createTaskTool: create.createTaskTool,
    updateTaskTool: update.updateTaskTool,
    scheduleTaskTool: schedule.scheduleTaskTool,
    resetAppDb: db.resetAppDb,
  };
});

beforeEach(() => {
  tools.resetAppDb();
});

describe('task persistence + schedules (LibSQL :memory:)', () => {
  it('creates, updates and lists a task through the tools', async () => {
    const created = await callTool<{ taskId: string; title: string; status: string }>(
      tools.createTaskTool,
      { title: 'ship the refactor', priority: 'high' }
    );
    expect(created.title).toBe('ship the refactor');
    expect(created.status).toBe('pending');

    const updated = await callTool<{ updated: boolean; task?: { status: string } }>(
      tools.updateTaskTool,
      { taskId: created.taskId, status: 'completed' }
    );
    expect(updated.updated).toBe(true);
    expect(updated.task?.status).toBe('completed');

    const missing = await callTool<{ updated: boolean; reason?: string }>(tools.updateTaskTool, {
      taskId: 'nope',
      status: 'completed',
    });
    expect(missing).toMatchObject({ updated: false, reason: 'NOT_FOUND' });
  });

  it('schedules a task and attaches the schedule id', async () => {
    const created = await callTool<{ taskId: string }>(tools.createTaskTool, {
      title: 'weekly review',
    });

    const schedules = {
      get: async () => null,
      create: async (input: { id: string; cron: string }) => ({
        id: input.id,
        cron: input.cron,
        status: 'active',
        nextFireAt: 1_700_000_000_000,
      }),
    } as unknown as Schedules;

    const scheduled = await callTool<{
      scheduled: boolean;
      scheduleId?: string;
      cron?: string;
      nextFireAt?: number;
    }>(tools.scheduleTaskTool, { taskId: created.taskId, interval: '1h' }, { mastra: { schedules } });

    expect(scheduled.scheduled).toBe(true);
    expect(scheduled.scheduleId).toBe(`task-${created.taskId}`);
    expect(scheduled.cron).toBe('0 */1 * * *');
    expect(scheduled.nextFireAt).toBe(1_700_000_000_000);
  });

  it('rejects an invalid schedule without touching storage', async () => {
    const created = await callTool<{ taskId: string }>(tools.createTaskTool, {
      title: 'no schedule',
    });
    const result = await callTool<{ scheduled: boolean; reason?: string }>(
      tools.scheduleTaskTool,
      { taskId: created.taskId }
    );
    expect(result).toMatchObject({ scheduled: false, reason: 'INVALID_SCHEDULE' });
  });
});
