import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { ToolExecutionContext } from '@mastra/core/tools';
import {
  scheduleTaskTool,
  intervalToCron,
} from '../../../../../src/mastra/domains/task-management/tools/schedule-task';
import { runTool } from '../../../../../src/mastra/shared/tools/run-tool';
import { getAppDb, resetAppDb } from '../../../../../src/mastra/shared/config/db';
import { createTaskRepository, type TaskRepository } from '../../../../../src/mastra/domains/task-management/repo';
import { eventBus } from '../../../../../src/mastra/shared/events';
import type { TaskScheduledEvent } from '../../../../../src/mastra/domains/task-management/events';

interface ScheduleTaskOutput {
  taskId: string;
  scheduled: boolean;
  reason?: string;
  scheduleId?: string;
  cron?: string;
  nextFireAt?: number;
  message: string;
}

/**
 * Deterministic fake of the `mastra.schedules` service (spec 05 Scenario 4's
 * unit tier — no real Mastra instance, no second database). Emulates the
 * `agent_<slug>` id normalization and the duplicate-id throw.
 */
function createFakeSchedules() {
  const rows = new Map<
    string,
    { id: string; agentId: string; cron: string; prompt: string; timezone?: string; status: string; nextFireAt: number }
  >();
  const norm = (id: string) => {
    const bare = id.trim().replace(/^agent_/, '');
    return 'agent_' + bare.toLowerCase().replace(/\s+/g, '-');
  };
  const calls = { create: [] as unknown[], update: [] as Array<[string, unknown]>, get: [] as string[] };
  const state = { conflictOnce: false };

  return {
    rows,
    calls,
    /** make the next create() throw SCHEDULES_ID_EXISTS even though get() missed (race simulation) */
    forceConflictOnce() {
      state.conflictOnce = true;
    },
    schedules: {
      async get(id: string) {
        calls.get.push(id);
        return rows.get(norm(id)) ?? null;
      },
      async create(input: { id?: string; agentId: string; cron: string; prompt: string; timezone?: string; status?: string }) {
        calls.create.push(input);
        const id = norm(input.id ?? `random-${rows.size}`);
        if (state.conflictOnce) {
          state.conflictOnce = false;
          // a concurrent writer created the row between our get() and create()
          if (!rows.has(id)) {
            rows.set(id, {
              id,
              agentId: input.agentId,
              cron: '5 4 * * *',
              prompt: 'racer',
              status: 'active',
              nextFireAt: Date.now() + 60_000,
            });
          }
          throw Object.assign(new Error(`a schedule with id "${id}" already exists`), {
            code: 'SCHEDULES_ID_EXISTS',
          });
        }
        if (rows.has(id)) {
          throw Object.assign(new Error(`a schedule with id "${id}" already exists`), {
            code: 'SCHEDULES_ID_EXISTS',
          });
        }
        const row = {
          id,
          agentId: input.agentId,
          cron: input.cron,
          prompt: input.prompt,
          timezone: input.timezone,
          status: input.status ?? 'active',
          nextFireAt: Date.now() + 60_000,
        };
        rows.set(id, row);
        return { ...row };
      },
      async update(id: string, patch: { cron?: string; timezone?: string; prompt?: string; status?: string }) {
        calls.update.push([id, patch]);
        const row = rows.get(norm(id));
        if (!row) throw new Error(`Schedule "${id}" not found.`);
        Object.assign(row, patch);
        return { ...row };
      },
      async list() {
        return [...rows.values()];
      },
    },
  };
}

function ctxWith(schedules: unknown) {
  return { mastra: { schedules } } as unknown as Partial<ToolExecutionContext>;
}

describe('intervalToCron (back-compat mapping)', () => {
  it('maps m/h/d intervals to cron per spec 05 §3.4', () => {
    expect(intervalToCron('15m')).toBe('*/15 * * * *');
    expect(intervalToCron('1h')).toBe('0 */1 * * *');
    expect(intervalToCron('2d')).toBe('0 0 */2 * * *');
  });
  it('rejects malformed intervals', () => {
    expect(intervalToCron('7x')).toBeNull();
    expect(intervalToCron('0m')).toBeNull();
    expect(intervalToCron('week')).toBeNull();
  });
});

describe('ScheduleTaskTool (real schedules via context.mastra.schedules)', () => {
  const saved = { db: process.env.DATABASE_URL, libsql: process.env.LIBSQL_URL };
  let repo: TaskRepository;
  let events: TaskScheduledEvent[] = [];
  let unsub: () => void;

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
    events = [];
    unsub = eventBus.subscribe<TaskScheduledEvent>('task.scheduled', (e) => { events.push(e); });
  });

  afterEach(() => unsub());

  it('degrades with SCHEDULING_UNAVAILABLE when context.mastra is absent (no fake id ever)', async () => {
    const task = await repo.createTask({ title: 'unavailable scheduling' });
    const result = await runTool<ScheduleTaskOutput>(scheduleTaskTool, {
      taskId: task.id,
      cron: '0 9 * * *',
    });

    expect(result.scheduled).toBe(false);
    expect(result.reason).toBe('SCHEDULING_UNAVAILABLE');
    expect(result.scheduleId).toBeUndefined();
    expect((await repo.getTask(task.id))?.scheduleId).toBeUndefined();
    expect(events).toHaveLength(0);
  });

  it('INVALID_SCHEDULE when neither cron nor a parseable interval is given', async () => {
    const task = await repo.createTask({ title: 'bad schedule' });
    const result = await runTool<ScheduleTaskOutput>(scheduleTaskTool, {
      taskId: task.id,
      interval: '7x',
    });
    expect(result.scheduled).toBe(false);
    expect(result.reason).toBe('INVALID_SCHEDULE');
  });

  it('TASK_NOT_FOUND never touches the schedules service', async () => {
    const fake = createFakeSchedules();
    const result = await runTool<ScheduleTaskOutput>(
      scheduleTaskTool,
      { taskId: 'ghost', cron: '0 9 * * *' },
      ctxWith(fake.schedules)
    );
    expect(result.scheduled).toBe(false);
    expect(result.reason).toBe('TASK_NOT_FOUND');
    expect(fake.calls.create).toHaveLength(0);
  });

  it('creates an agent reminder schedule, links the row, publishes task.scheduled', async () => {
    const fake = createFakeSchedules();
    const task = await repo.createTask({ title: 'daily standup' });

    const result = await runTool<ScheduleTaskOutput>(
      scheduleTaskTool,
      { taskId: task.id, cron: '0 9 * * *', timezone: 'UTC' },
      ctxWith(fake.schedules)
    );

    expect(result.scheduled).toBe(true);
    expect(fake.calls.create).toHaveLength(1);
    const input = fake.calls.create[0] as Record<string, unknown>;
    expect(input.id).toBe(`task-${task.id}`); // API normalizes to agent_task-<slug>
    expect(input.agentId).toBe('task-management-agent'); // agent reminder, NOT workflowId
    expect(input.cron).toBe('0 9 * * *');
    expect(typeof input.prompt).toBe('string');

    expect(result.scheduleId).toBe(`agent_task-${task.id}`);
    expect(result.nextFireAt).toBeTypeOf('number');

    const linked = await repo.getTask(task.id);
    expect(linked?.scheduleId).toBe(`agent_task-${task.id}`);

    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      taskId: task.id,
      scheduleId: `agent_task-${task.id}`,
      interval: '0 9 * * *',
    });
  });

  it('interval "1h" is converted to cron for back-compat', async () => {
    const fake = createFakeSchedules();
    const task = await repo.createTask({ title: 'hourly reminder' });
    const result = await runTool<ScheduleTaskOutput>(
      scheduleTaskTool,
      { taskId: task.id, interval: '1h' },
      ctxWith(fake.schedules)
    );
    expect(result.scheduled).toBe(true);
    expect(result.cron).toBe('0 */1 * * *');
    expect(fake.rows.get(`agent_task-${task.id}`)?.cron).toBe('0 */1 * * *');
  });

  it('re-scheduling the same task UPDATES the existing row (idempotent tool over a throwing API)', async () => {
    const fake = createFakeSchedules();
    const task = await repo.createTask({ title: 'reschedule me' });

    const first = await runTool<ScheduleTaskOutput>(
      scheduleTaskTool,
      { taskId: task.id, cron: '0 9 * * *' },
      ctxWith(fake.schedules)
    );
    expect(first.scheduled).toBe(true);

    const second = await runTool<ScheduleTaskOutput>(
      scheduleTaskTool,
      { taskId: task.id, cron: '30 8 * * 1-5' },
      ctxWith(fake.schedules)
    );

    expect(second.scheduled).toBe(true);
    expect(fake.calls.create).toHaveLength(1); // second run went straight to update
    expect(fake.calls.update).toHaveLength(1);
    expect(fake.rows.get(`agent_task-${task.id}`)?.cron).toBe('30 8 * * 1-5');
    expect(fake.rows.size).toBe(1);
  });

  it('recovers via update when create races a duplicate id', async () => {
    const fake = createFakeSchedules();
    const task = await repo.createTask({ title: 'racy schedule' });
    fake.forceConflictOnce();

    const result = await runTool<ScheduleTaskOutput>(
      scheduleTaskTool,
      { taskId: task.id, cron: '0 12 * * *' },
      ctxWith(fake.schedules)
    );

    expect(result.scheduled).toBe(true);
    expect(fake.calls.update).toHaveLength(1);
    expect(fake.rows.get(`agent_task-${task.id}`)?.cron).toBe('0 12 * * *');
    expect((await repo.getTask(task.id))?.scheduleId).toBe(`agent_task-${task.id}`);
  });

  it('enabled:false creates the schedule paused', async () => {
    const fake = createFakeSchedules();
    const task = await repo.createTask({ title: 'parked schedule' });
    const result = await runTool<ScheduleTaskOutput>(
      scheduleTaskTool,
      { taskId: task.id, cron: '0 9 * * *', enabled: false },
      ctxWith(fake.schedules)
    );
    expect(result.scheduled).toBe(true);
    expect(fake.rows.get(`agent_task-${task.id}`)?.status).toBe('paused');
  });
});
