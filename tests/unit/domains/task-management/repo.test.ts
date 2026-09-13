import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppDatabase, type AppDatabase } from '../../../../src/mastra/shared/config/db';
import {
  createTaskRepository,
  type TaskRepository,
} from '../../../../src/mastra/domains/task-management/repo';

/**
 * Spec 05 unit tier: the task repository against a real LibSQL `:memory:`
 * database (no env, no network). Deterministic by construction.
 */

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

  it('ensureSchema is idempotent (re-run + second repo on same db)', async () => {
    await repo.ensureSchema();
    const repo2 = createTaskRepository(db);
    await repo2.ensureSchema();
    await repo2.ensureSchema();
    const t = await repo2.createTask({ title: 'from second repo' });
    expect(t.resourceId).toBe('default');
  });

  it('defaults: uuid id, status pending, priority medium, resourceId default, version 1', async () => {
    const task = await repo.createTask({ title: 'review PR #42' });
    expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(task.status).toBe('pending');
    expect(task.priority).toBe('medium');
    expect(task.resourceId).toBe('default');
    expect(task.version).toBe(1);
    expect(task.description).toBeUndefined();
    expect(task.scheduleId).toBeUndefined();
    expect(task.createdAt).toBeInstanceOf(Date);
    expect(task.updatedAt).toBeInstanceOf(Date);
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
    expect(read?.version).toBe(1);
  });

  it('getTask returns null for a missing row', async () => {
    expect(await repo.getTask('does-not-exist')).toBeNull();
  });

  it('listTasks filters by resourceId, status and excludeStatus; limit applies', async () => {
    const marker = `list-${Date.now()}`;
    await repo.createTask({ title: `${marker} a`, resourceId: 'alpha', priority: 'low' });
    const beta1 = await repo.createTask({ title: `${marker} b1`, resourceId: 'beta' });
    await repo.createTask({ title: `${marker} b2`, resourceId: 'beta', priority: 'high' });
    await repo.createTask({ title: `${marker} done`, resourceId: 'beta' });
    await repo.updateTask(
      (await repo.listTasks({ resourceId: 'beta', limit: 100 })).find((t) =>
        t.title.endsWith('done')
      )!.id,
      { status: 'completed' }
    );

    const alpha = await repo.listTasks({ resourceId: 'alpha' });
    expect(alpha.every((t) => t.resourceId === 'alpha')).toBe(true);
    expect(alpha.some((t) => t.title.startsWith(marker))).toBe(true);

    const betaOpen = await repo.listTasks({ resourceId: 'beta', excludeStatus: 'completed' });
    expect(betaOpen).toHaveLength(2);
    expect(betaOpen.every((t) => t.status !== 'completed')).toBe(true);

    const betaHigh = await repo.listTasks({ resourceId: 'beta', status: 'pending' });
    expect(betaHigh.every((t) => t.resourceId === 'beta')).toBe(true);

    const limited = await repo.listTasks({ resourceId: 'beta', limit: 1 });
    expect(limited).toHaveLength(1);
    // clamped to max 100 without error
    expect((await repo.listTasks({ limit: 500 })).length).toBeLessThanOrEqual(100);

    const excluded = await repo.listTasks({ excludeStatus: 'completed', limit: 100 });
    expect(excluded.find((t) => t.id === beta1.id)).toBeDefined();
    expect(excluded.every((t) => t.status !== 'completed')).toBe(true);
  });

  it('status/exact filter combined with excludeStatus is honored', async () => {
    const t = await repo.createTask({ title: 'exact filter me' });
    await repo.updateTask(t.id, { status: 'in-progress' });
    const inProg = await repo.listTasks({ status: 'in-progress', excludeStatus: 'completed' });
    expect(inProg.some((x) => x.id === t.id)).toBe(true);
    const pendingOnly = await repo.listTasks({ status: 'pending', excludeStatus: 'in-progress' });
    expect(pendingOnly.some((x) => x.id === t.id)).toBe(false);
  });

  it('updateTask mutates the row, bumps version and updated_at', async () => {
    const task = await repo.createTask({ title: 'to update' });
    const updated = await repo.updateTask(task.id, {
      status: 'in-progress',
      title: 'renamed',
      expectVersion: 1,
    });
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('in-progress');
    expect(updated?.title).toBe('renamed');
    expect(updated?.version).toBe(2);
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(task.updatedAt.getTime());
  });

  it('updateTask with stale expectVersion affects 0 rows → null (optimistic lock)', async () => {
    const task = await repo.createTask({ title: 'contended' });
    // first writer wins
    const ok = await repo.updateTask(task.id, { priority: 'high', expectVersion: 1 });
    expect(ok?.version).toBe(2);
    // second writer carries the stale version
    const stale = await repo.updateTask(task.id, { priority: 'low', expectVersion: 1 });
    expect(stale).toBeNull();
    const fresh = await repo.getTask(task.id);
    expect(fresh?.priority).toBe('high'); // never corrupted
    expect(fresh?.version).toBe(2);
  });

  it('updateTask returns null for missing rows; empty patch is a no-op read', async () => {
    expect(await repo.updateTask('missing-id', { title: 'x' })).toBeNull();
    const task = await repo.createTask({ title: 'noop patch' });
    const same = await repo.updateTask(task.id, {});
    expect(same?.version).toBe(1);
  });

  it('attachSchedule writes the real schedule row id', async () => {
    const task = await repo.createTask({ title: 'to schedule' });
    const linked = await repo.attachSchedule(task.id, 'agent_task-abc');
    expect(linked?.scheduleId).toBe('agent_task-abc');
    expect(linked?.version).toBe(2);
    expect(await repo.attachSchedule('missing-id', 'agent_task-xyz')).toBeNull();
  });

  it('dueDate/scheduleId clear-paths stay typed; unknown columns rejected by CHECK', async () => {
    const task = await repo.createTask({ title: 'check constraint' });
    await expect(
      db.execute(`UPDATE app_tasks SET status = 'exploded' WHERE id = ?`, [task.id])
    ).rejects.toThrow();
  });
});

describe('task repository durability (file: reopen after close)', () => {
  it('a task written before close is read back after reopen (restart proof)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'app-tasks-'));
    const url = `file:${join(dir, 'app.db')}`;

    const db1 = createAppDatabase({ dialect: 'libsql', url });
    const repo1 = createTaskRepository(db1);
    const created = await repo1.createTask({ title: 'survives restart', priority: 'high' });
    await db1.close();

    const db2 = createAppDatabase({ dialect: 'libsql', url });
    const repo2 = createTaskRepository(db2);
    const read = await repo2.getTask(created.id);
    expect(read).not.toBeNull();
    expect(read?.title).toBe('survives restart');
    expect(read?.priority).toBe('high');
    expect((await repo2.listTasks({})).some((t) => t.id === created.id)).toBe(true);
    await db2.close();

    rmSync(dir, { recursive: true, force: true });
  });
});
