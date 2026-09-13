import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import {
  createAppDatabase,
  resetAppDb,
  type AppDatabase,
} from '../../src/mastra/shared/config/db';
import { createTaskRepository } from '../../src/mastra/domains/task-management/repo';

/**
 * Spec 05 integration tier.
 *  - The PostgreSQL run of the repository suite is gated on DATABASE_URL
 *    (`npm run test:integration` without it skips this block cleanly).
 *  - The schedules probe runs OFFLINE against a real `mastra.schedules`
 *    service on `:memory:`/tmp-file LibSQL: asserts the `agent_<slug>` id
 *    normalization, the persisted row + nextFireAt, `list()` state and
 *    run()'s claim record { scheduleId, claimId, scheduledFireAt } — NOT an
 *    actual agent fire (Scenario 4: agent-schedule run() records no trigger
 *    row and an observable fire additionally needs AgentScheduleWorker +
 *    a provider key).
 */

const pgUrl = process.env.DATABASE_URL;
const isPostgres = Boolean(pgUrl && pgUrl.startsWith('postgres'));

describe.skipIf(!isPostgres)('task repository on PostgreSQL (gated: DATABASE_URL)', () => {
  let db: AppDatabase;

  beforeAll(() => {
    db = createAppDatabase({ dialect: 'pg', url: pgUrl as string });
  });

  afterAll(async () => {
    await db.close();
  });

  it('runs the same CRUD + optimistic-lock contract on the pg dialect', async () => {
    const repo = createTaskRepository(db);
    await repo.ensureSchema();
    await repo.ensureSchema(); // idempotent

    const created = await repo.createTask({
      title: 'pg roundtrip',
      description: 'same DDL, $n placeholders',
      priority: 'high',
      dueDate: '2026-12-31T00:00:00.000Z',
    });
    expect(created.resourceId).toBe('default');

    const read = await repo.getTask(created.id);
    expect(read?.title).toBe('pg roundtrip');
    expect(read?.dueDate?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(read?.version).toBe(1);

    const ok = await repo.updateTask(created.id, { status: 'in-progress', expectVersion: 1 });
    expect(ok?.version).toBe(2);
    const stale = await repo.updateTask(created.id, { status: 'completed', expectVersion: 1 });
    expect(stale).toBeNull();

    const listed = await repo.listTasks({ excludeStatus: 'completed', limit: 100 });
    expect(listed.some((t) => t.id === created.id)).toBe(true);

    await db.execute('DELETE FROM app_tasks WHERE id = $1', [created.id]);
  });
});

describe('schedules service probe (real Mastra, tmp LibSQL file)', () => {
  const saved = { db: process.env.DATABASE_URL, libsql: process.env.LIBSQL_URL };
  let dir: string;
  let mastra: Mastra;
  let repoDb: AppDatabase;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'spec05-integration-'));
    const url = `file:${join(dir, 'mastra.db')}`;
    delete process.env.DATABASE_URL;
    process.env.LIBSQL_URL = url; // app tables live in the SAME file (ADR-008)
    resetAppDb();
    mastra = new Mastra({
      storage: new LibSQLStore({ id: 'spec05-integration', url }),
    });
    repoDb = createAppDatabase({ dialect: 'libsql', url });
  });

  afterAll(async () => {
    resetAppDb();
    if (saved.db !== undefined) process.env.DATABASE_URL = saved.db;
    else delete process.env.DATABASE_URL;
    if (saved.libsql !== undefined) process.env.LIBSQL_URL = saved.libsql;
    else delete process.env.LIBSQL_URL;
    await repoDb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('schedules storage domain is served by the LibSQL adapter', async () => {
    const store = await mastra.getStorage()?.getStore('schedules');
    expect(store).toBeTruthy();
  });

  it('create → agent_<slug> row id, computed nextFireAt; list() shows it; run() returns the claim record', async () => {
    const created = await mastra.schedules.create({
      id: 'task-probe-42',
      agentId: 'task-management-agent',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'Reminder: probe task',
    });

    // Scenario 4 normalization: agent schedules take the agent_ prefix
    expect(created.id).toBe('agent_task-probe-42');
    expect(created.agentId).toBe('task-management-agent');
    expect(created.cron).toBe('0 9 * * *');
    expect(created.status).toBe('active');
    expect(created.nextFireAt).toBeGreaterThan(Date.now() - 1000);

    const fetched = await mastra.schedules.get('task-probe-42'); // bare id resolves
    expect(fetched?.id).toBe('agent_task-probe-42');

    const listed = await mastra.schedules.list({ agentId: 'task-management-agent' });
    expect(listed.some((s) => s.id === 'agent_task-probe-42')).toBe(true);

    // run() for an AGENT schedule publishes to the agent-schedules topic and
    // records NO trigger row — assert the claim record, not a fire.
    const claim = await mastra.schedules.run('agent_task-probe-42');
    expect(claim).toMatchObject({ scheduleId: 'agent_task-probe-42' });
    expect(typeof claim.claimId).toBe('string');
    expect(claim.claimId.length).toBeGreaterThan(0);
    expect(claim.scheduledFireAt).toBeTypeOf('number');

    // duplicate id throws at the API level — the schedule_task TOOL handles
    // this by updating (unit-tested); here we pin the raw behavior.
    await expect(
      mastra.schedules.create({
        id: 'task-probe-42',
        agentId: 'task-management-agent',
        cron: '0 9 * * *',
        prompt: 'dupe',
      })
    ).rejects.toThrow(/already exists/);

    await mastra.schedules.delete('agent_task-probe-42');
    expect(await mastra.schedules.get('task-probe-42')).toBeNull();
  });

  it('app_tasks roundtrip proves custom tables live beside Mastra-managed domains in one file', async () => {
    const repo = createTaskRepository(repoDb);
    const task = await repo.createTask({ title: 'beside mastra tables', resourceId: 'int-1' });
    const read = await repo.getTask(task.id);
    expect(read?.title).toBe('beside mastra tables');

    // Mastra's own tables coexist in the same sqlite file
    const { rows } = await repoDb.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mastra_%'"
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
