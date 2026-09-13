import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { updateTaskTool } from '../../../../../src/mastra/domains/task-management/tools/update-task';
import { runTool } from '../../../../../src/mastra/shared/tools/run-tool';
import { getAppDb, resetAppDb } from '../../../../../src/mastra/shared/config/db';
import { createTaskRepository, type TaskRepository } from '../../../../../src/mastra/domains/task-management/repo';
import { eventBus } from '../../../../../src/mastra/shared/events';
import type {
  TaskUpdatedEvent,
  TaskCompletedEvent,
} from '../../../../../src/mastra/domains/task-management/events';

interface UpdateTaskOutput {
  taskId: string;
  updated: boolean;
  reason?: 'NOT_FOUND' | 'CONFLICT';
  message: string;
  task?: { status: string; priority: string; version: number; updatedAt: string };
}

/**
 * Spec 05 fake-assert inventory #2: the old tool returned an unconditional
 * `{ updated: true }` without touching a database. This suite covers
 * NOT_FOUND / CONFLICT / success against `:memory:` LibSQL.
 */

describe('UpdateTaskTool (guarded real writes)', () => {
  const saved = { db: process.env.DATABASE_URL, libsql: process.env.LIBSQL_URL };
  let repo: TaskRepository;
  let updatedEvents: TaskUpdatedEvent[] = [];
  let completedEvents: TaskCompletedEvent[] = [];
  let unsubs: Array<() => void> = [];

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.LIBSQL_URL = ':memory:';
    resetAppDb();
    const db = await getAppDb();
    if (!db) throw new Error('app db unavailable in unit tier');
    repo = createTaskRepository(db);
  });

  afterAll(() => {
    if (saved.db !== undefined) process.env.DATABASE_URL = saved.db;
    else delete process.env.DATABASE_URL;
    if (saved.libsql !== undefined) process.env.LIBSQL_URL = saved.libsql;
    else delete process.env.LIBSQL_URL;
    resetAppDb();
  });

  beforeEach(() => {
    updatedEvents = [];
    completedEvents = [];
    unsubs = [
      eventBus.subscribe<TaskUpdatedEvent>('task.updated', (e) => { updatedEvents.push(e); }),
      eventBus.subscribe<TaskCompletedEvent>('task.completed', (e) => { completedEvents.push(e); }),
    ];
  });

  afterEach(() => {
    unsubs.forEach((u) => u());
  });

  it('updates the persisted row, bumps the version and publishes task.updated', async () => {
    const task = await repo.createTask({ title: 'PR #42 review' });
    const result = await runTool<UpdateTaskOutput>(updateTaskTool, {
      taskId: task.id,
      status: 'in-progress',
    });

    expect(result.updated).toBe(true);
    expect(result.task?.status).toBe('in-progress');
    expect(result.task?.version).toBe(2);

    const read = await repo.getTask(task.id);
    expect(read?.status).toBe('in-progress');
    expect(read?.version).toBe(2);
    expect(read?.updatedAt.getTime()).toBeGreaterThanOrEqual(task.updatedAt.getTime());

    expect(updatedEvents).toHaveLength(1);
    expect(updatedEvents[0].payload.taskId).toBe(task.id);
    expect(updatedEvents[0].payload.changes).toEqual({ status: 'in-progress' });
    expect(completedEvents).toHaveLength(0);
  });

  it('status → completed also publishes task.completed', async () => {
    const task = await repo.createTask({ title: 'finish me' });
    await repo.updateTask(task.id, { status: 'in-progress' });

    const result = await runTool<UpdateTaskOutput>(updateTaskTool, {
      taskId: task.id,
      status: 'completed',
    });

    expect(result.updated).toBe(true);
    expect((await repo.getTask(task.id))?.status).toBe('completed');
    expect(updatedEvents).toHaveLength(1);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].payload.taskId).toBe(task.id);
  });

  it('missing task → updated:false, reason NOT_FOUND (no silent fake success)', async () => {
    const result = await runTool<UpdateTaskOutput>(updateTaskTool, {
      taskId: 'no-such-task',
      status: 'completed',
    });
    expect(result.updated).toBe(false);
    expect(result.reason).toBe('NOT_FOUND');
    expect(updatedEvents).toHaveLength(0);
  });

  it('stale expectedVersion → updated:false, reason CONFLICT + current row, row untouched (Scenario 5)', async () => {
    const task = await repo.createTask({ title: 'contended task' });
    // another session already moved the row to version 2
    await repo.updateTask(task.id, { priority: 'high', expectVersion: 1 });

    const result = await runTool<UpdateTaskOutput>(updateTaskTool, {
      taskId: task.id,
      title: 'clobber attempt',
      expectedVersion: 1,
    });

    expect(result.updated).toBe(false);
    expect(result.reason).toBe('CONFLICT');
    expect(result.task?.version).toBe(2);

    const fresh = await repo.getTask(task.id);
    expect(fresh?.title).toBe('contended task'); // never corrupted
    expect(fresh?.priority).toBe('high');
    expect(updatedEvents).toHaveLength(0);
  });

  it('default compare-and-swap uses the freshly-read version (single-session happy race)', async () => {
    const task = await repo.createTask({ title: 'cas task' });
    const first = await runTool<UpdateTaskOutput>(updateTaskTool, {
      taskId: task.id,
      title: 'v2 title',
    });
    expect(first.updated).toBe(true);

    const second = await runTool<UpdateTaskOutput>(updateTaskTool, {
      taskId: task.id,
      title: 'v3 title',
    });
    expect(second.updated).toBe(true);
    expect(second.task?.version).toBe(3);
  });
});
