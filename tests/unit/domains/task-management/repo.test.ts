import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppDatabase, type AppDatabase } from '../../../../src/mastra/shared/config/db';
import { createTaskRepository } from '../../../../src/mastra/domains/task-management/repo';
import type { TaskRepository } from '../../../../src/mastra/domains/task-management/repo';

describe('task repository (LibSQL :memory:)', () => {
  let db: AppDatabase;
  let repo: TaskRepository;

  beforeAll(async () => {
    db = createAppDatabase({ dialect: 'libsql', url: ':memory:' });
    repo = createTaskRepository(db);
    await repo.ensureSchema();
  });

  afterAll(async () => {
    await db.close();
  });

  it('defaults: uuid id, pending status, medium priority, default resource', async () => {
    const task = await repo.createTask({ title: 'review PR #42' });
    expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(task.status).toBe('pending');
    expect(task.priority).toBe('medium');
    expect(task.resourceId).toBe('default');
    expect(task.description).toBeUndefined();
    expect(task.scheduleId).toBeUndefined();
  });

  it('create + getTask roundtrip keeps every field', async () => {
    const created = await repo.createTask({
      title: 'full task',
      description: 'with everything',
      priority: 'high',
      dueDate: '2026-12-31T00:00:00.000Z',
      resourceId: 'team-x',
    });
    const read = await repo.getTask(created.id);
    expect(read).not.toBeNull();
    expect(read?.title).toBe('full task');
    expect(read?.description).toBe('with everything');
    expect(read?.priority).toBe('high');
    expect(read?.dueDate?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(read?.resourceId).toBe('team-x');
  });

  it('getTask returns null for a missing row and updateTask returns null too', async () => {
    expect(await repo.getTask('does-not-exist')).toBeNull();
    expect(await repo.updateTask('does-not-exist', { status: 'completed' })).toBeNull();
  });

  it('updates status and title', async () => {
    const task = await repo.createTask({ title: 'rename me' });
    const updated = await repo.updateTask(task.id, { title: 'renamed', status: 'in-progress' });
    expect(updated?.title).toBe('renamed');
    expect(updated?.status).toBe('in-progress');
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(task.updatedAt.getTime());
  });

  it('lists with resource/status filters and a clamped limit', async () => {
    const marker = `list-${Date.now()}`;
    await repo.createTask({ title: `${marker} a`, resourceId: 'alpha' });
    await repo.createTask({ title: `${marker} b1`, resourceId: 'beta' });
    const b2 = await repo.createTask({ title: `${marker} b2`, resourceId: 'beta' });
    await repo.updateTask(b2.id, { status: 'completed' });

    const alpha = await repo.listTasks({ resourceId: 'alpha' });
    expect(alpha.every(task => task.resourceId === 'alpha')).toBe(true);

    const betaOpen = await repo.listTasks({ resourceId: 'beta', excludeStatus: 'completed' });
    expect(betaOpen).toHaveLength(1);
    expect(betaOpen[0].title).toBe(`${marker} b1`);

    const limited = await repo.listTasks({ resourceId: 'beta', limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it('attaches a schedule id', async () => {
    const task = await repo.createTask({ title: 'scheduled' });
    const attached = await repo.attachSchedule(task.id, 'task-123');
    expect(attached?.scheduleId).toBe('task-123');
  });
});
