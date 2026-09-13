import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  dailyDigestWorkflow,
  collectOpenTasksStep,
  buildDigestStep,
  collectOpenTasks,
  buildDigest,
} from '../../../../../src/mastra/domains/task-management/workflows/daily-digest';
import { getAppDb, resetAppDb } from '../../../../../src/mastra/shared/config/db';
import { createTaskRepository, type TaskRepository } from '../../../../../src/mastra/domains/task-management/repo';
import { eventBus } from '../../../../../src/mastra/shared/events';
import type { Task } from '../../../../../src/mastra/domains/task-management/entities/task';
import type { TasksDigestReadyEvent } from '../../../../../src/mastra/domains/task-management/events';

/**
 * Spec 05 §3.5 — the digest is LLM-free, so it must run offline with no
 * provider keys; the two steps are executed directly (they are plain
 * functions of their inputData + the env-driven getAppDb() singleton,
 * pinned to `:memory:` here).
 */

interface StepContextLike {
  execute: (ctx: Record<string, unknown>) => Promise<unknown>;
}

describe('daily-digest core (pure, :memory:)', () => {
  const saved = { db: process.env.DATABASE_URL, libsql: process.env.LIBSQL_URL };
  let repo: TaskRepository;

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

  function task(partial: Partial<Task> & { id: string; title: string }): Task {
    return {
      status: 'pending',
      priority: 'medium',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...partial,
    };
  }

  it('collectOpenTasks excludes completed rows and scopes by resourceId', async () => {
    await repo.createTask({ title: 'open-a', resourceId: 'dg-1' });
    const b = await repo.createTask({ title: 'open-b', resourceId: 'dg-1' });
    await repo.createTask({ title: 'other-resource', resourceId: 'dg-2' });
    await repo.updateTask(b.id, { status: 'completed' });

    const { open } = await collectOpenTasks(repo, { date: '2026-09-13', resourceId: 'dg-1' });
    expect(open.map((t) => t.title)).toEqual(['open-a']);
  });

  it('buildDigest renders markdown lines + counts', () => {
    const digest = buildDigest(
      { date: '2026-09-13', resourceId: 'dg-1' },
      [
        task({ id: '1', title: 'Alpha', priority: 'high', dueDate: new Date('2026-09-20T00:00:00.000Z') }),
        task({ id: '2', title: 'Beta', status: 'in-progress' }),
      ]
    );
    expect(digest.openCount).toBe(2);
    expect(digest.lines[0]).toBe('## Daily digest — 2026-09-13 (resource dg-1)');
    expect(digest.lines[1]).toBe('- [pending] Alpha (high) · due 2026-09-20');
    expect(digest.lines[2]).toBe('- [in-progress] Beta (medium)');
  });

  it('empty open set yields the _No open tasks._ placeholder', () => {
    const digest = buildDigest({ date: '2026-09-13', resourceId: 'x' }, []);
    expect(digest.openCount).toBe(0);
    expect(digest.lines[1]).toBe('_No open tasks._');
  });

  it('the two steps chain end-to-end and publish tasks.digest.ready', async () => {
    await repo.createTask({ title: 'chain-me', resourceId: 'dg-chain' });
    const done = await repo.createTask({ title: 'chain-done', resourceId: 'dg-chain' });
    await repo.updateTask(done.id, { status: 'completed' });

    const received: TasksDigestReadyEvent[] = [];
    const unsub = eventBus.subscribe<TasksDigestReadyEvent>('tasks.digest.ready', (e) => {
      received.push(e);
    });

    const step1 = collectOpenTasksStep as unknown as StepContextLike;
    const step2 = buildDigestStep as unknown as StepContextLike;

    const out1 = await step1.execute({
      inputData: { resourceId: 'dg-chain', date: '2026-09-13' },
    }) as { date: string; openCount?: number; open: unknown[] };
    expect(out1.open).toHaveLength(1);

    const out2 = await step2.execute({ inputData: out1 }) as {
      date: string;
      openCount: number;
      lines: string[];
    };
    expect(out2.openCount).toBe(1);
    expect(out2.lines.some((l) => l.includes('chain-me'))).toBe(true);

    expect(received).toHaveLength(1);
    expect(received[0].payload.resourceId).toBe('dg-chain');
    expect(received[0].payload.openCount).toBe(1);
    unsub();
  });

  it('workflow constructs with its declarative schedule (cron validated at build; wf row id = wf_daily-digest)', () => {
    expect(dailyDigestWorkflow).toBeDefined();
    const id = (dailyDigestWorkflow as unknown as { id?: string }).id;
    expect(id ?? (dailyDigestWorkflow as unknown as { name?: string }).name).toBe('daily-digest');
  });
});
