import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { ToolExecutionContext } from '@mastra/core/tools';
import { createTaskTool } from '../../../../../src/mastra/domains/task-management/tools/create-task';
import { runTool } from '../../../../../src/mastra/shared/tools/run-tool';
import { getAppDb, resetAppDb } from '../../../../../src/mastra/shared/config/db';
import { createTaskRepository } from '../../../../../src/mastra/domains/task-management/repo';
import { eventBus } from '../../../../../src/mastra/shared/events';
import type { TaskCreatedEvent } from '../../../../../src/mastra/domains/task-management/events';

interface CreateTaskOutput {
  taskId: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string;
  createdAt: string;
}

/**
 * Spec 05 fake-assert inventory #1: this file used to assert ONLY the tool
 * return value (a `Math.random()` id). It now asserts the persisted row via
 * the repository on a real `:memory:` LibSQL database, plus event emission.
 */

async function repo() {
  const db = await getAppDb();
  if (!db) throw new Error('app db unavailable in unit tier');
  return createTaskRepository(db);
}

describe('CreateTaskTool (real persistence)', () => {
  const saved = { db: process.env.DATABASE_URL, libsql: process.env.LIBSQL_URL };

  beforeAll(() => {
    delete process.env.DATABASE_URL;
    process.env.LIBSQL_URL = ':memory:';
    resetAppDb();
  });

  afterAll(() => {
    if (saved.db !== undefined) process.env.DATABASE_URL = saved.db;
    else delete process.env.DATABASE_URL;
    if (saved.libsql !== undefined) process.env.LIBSQL_URL = saved.libsql;
    else delete process.env.LIBSQL_URL;
    resetAppDb();
  });

  let received: TaskCreatedEvent[] = [];
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    received = [];
    unsubscribe = eventBus.subscribe<TaskCreatedEvent>('task.created', e => {
      received.push(e);
    });
  });

  afterEach(() => {
    unsubscribe?.();
  });

  it('persists a task created with required fields and publishes task.created', async () => {
    const result = await runTool<CreateTaskOutput>(createTaskTool, { title: 'Test Task' });

    expect(result.taskId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(result.title).toBe('Test Task');
    expect(result.status).toBe('pending');
    expect(result.priority).toBe('medium');
    expect(result.createdAt).toBeDefined();

    const read = await (await repo()).getTask(result.taskId);
    expect(read).not.toBeNull();
    expect(read?.title).toBe('Test Task');
    expect(read?.resourceId).toBe('default');
    expect(read?.version).toBe(1);

    expect(received).toHaveLength(1);
    expect(received[0].payload.taskId).toBe(result.taskId);
    expect(received[0].payload.title).toBe('Test Task');
  });

  it('persists all fields (description, priority, dueDate) and emits the event', async () => {
    const result = await runTool<CreateTaskOutput>(createTaskTool, {
      title: 'Important Task',
      description: 'This is important',
      priority: 'high',
      dueDate: '2026-12-31T00:00:00.000Z',
    });

    expect(result.priority).toBe('high');
    expect(result.dueDate).toBe('2026-12-31T00:00:00.000Z');

    const read = await (await repo()).getTask(result.taskId);
    expect(read?.description).toBe('This is important');
    expect(read?.priority).toBe('high');
    expect(read?.dueDate?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(received).toHaveLength(1);
  });

  it('two creates produce two REAL distinct rows (was: unique Math.random ids)', async () => {
    const r1 = await runTool<CreateTaskOutput>(createTaskTool, { title: 'Task 1' });
    const r2 = await runTool<CreateTaskOutput>(createTaskTool, { title: 'Task 2' });
    expect(r1.taskId).not.toBe(r2.taskId);

    const repository = await repo();
    expect(await repository.getTask(r1.taskId)).not.toBeNull();
    expect(await repository.getTask(r2.taskId)).not.toBeNull();
    expect(received).toHaveLength(2);
  });

  it('stamps resourceId from context.agent (ToolExecutionContext has no top-level resourceId)', async () => {
    const result = await runTool<CreateTaskOutput>(createTaskTool, { title: 'Scoped task' }, {
      agent: { resourceId: 'team-alpha' },
    } as unknown as Partial<ToolExecutionContext>);

    const read = await (await repo()).getTask(result.taskId);
    expect(read?.resourceId).toBe('team-alpha');
  });

  it('created rows stay visible to listTasks across calls (durable, not per-call fake)', async () => {
    const result = await runTool<CreateTaskOutput>(createTaskTool, { title: 'Persisted forever' });
    const repository = await repo();
    const listed = await repository.listTasks({ status: 'pending', limit: 100 });
    expect(listed.some(t => t.id === result.taskId)).toBe(true);
  });
});
