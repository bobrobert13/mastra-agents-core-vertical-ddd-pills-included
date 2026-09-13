import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/logger';
import type { AppDatabase } from '../../shared/config/db';
import type { Task, TaskStatus, TaskPriority } from './entities/task';

/**
 * Task repository — owns the `app_tasks` custom table (ADR-008, spec 05 §3.2).
 * The table lives inside the same database file/URL as Mastra storage but is
 * OUTSIDE Mastra's migration system: `ensureSchema()` is additive and
 * idempotent, and Mastra's prune/retention never touches it.
 *
 * Dialect-portability: identical DDL for LibSQL and Postgres (ISO-8601 TEXT
 * timestamps by design); the only per-dialect code is placeholder syntax and
 * column introspection.
 */

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  resourceId?: string;
}

export interface UpdateTaskPatch {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string;
  scheduleId?: string;
  /** Optimistic lock (Scenario 5): the UPDATE only lands while the row is still at this version. */
  expectVersion?: number;
}

export interface ListTasksFilter {
  resourceId?: string;
  /** exact-match filter */
  status?: TaskStatus;
  /** set-based filter (the digest needs status ≠ completed) */
  excludeStatus?: TaskStatus;
  /** default 20, max 100 */
  limit?: number;
}

export interface TaskRepository {
  ensureSchema(): Promise<void>;
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  listTasks(filter?: ListTasksFilter): Promise<Task[]>;
  /** null = row missing OR expectVersion mismatch (caller distinguishes via a follow-up getTask). */
  updateTask(id: string, patch: UpdateTaskPatch): Promise<Task | null>;
  attachSchedule(id: string, scheduleId: string): Promise<Task | null>;
}

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS app_tasks (
  id           TEXT PRIMARY KEY,
  resource_id  TEXT NOT NULL DEFAULT 'default',
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL CHECK (status    IN ('pending','in-progress','completed')),
  priority     TEXT NOT NULL CHECK (priority  IN ('low','medium','high')),
  due_date     TEXT,
  schedule_id  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1
)`;

const CREATE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_app_tasks_resource_status ON app_tasks (resource_id, status)';

/**
 * Additive column migrations (spec 05 §3.7): future column additions append
 * entries here; each runs only when the column is missing. NEVER destructive
 * — Mastra's init/prune do not know about app tables.
 */
const ADDITIVE_COLUMN_MIGRATIONS: ReadonlyArray<{ column: string; ddl: string }> = [];

interface TaskRow {
  id: string;
  resource_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  schedule_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

const SELECT_COLUMNS =
  'id, resource_id, title, description, status, priority, due_date, schedule_id, created_at, updated_at, version';

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date ? new Date(row.due_date) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    scheduleId: row.schedule_id ?? undefined,
    resourceId: row.resource_id,
    version: Number(row.version),
  };
}

export function createTaskRepository(db: AppDatabase): TaskRepository {
  /** `$n` for pg, `?` for libsql; called in param-append order. */
  const ph =
    db.dialect === 'pg'
      ? (i: number): string => `$${i + 1}`
      : (_i: number): string => '?';

  let ensured: Promise<void> | undefined;

  async function ensureSchema(): Promise<void> {
    if (!ensured) {
      ensured = (async () => {
        await db.execute(CREATE_TABLE_SQL);
        await db.execute(CREATE_INDEX_SQL);
        if (ADDITIVE_COLUMN_MIGRATIONS.length > 0) {
          const existing = await existingColumns();
          for (const migration of ADDITIVE_COLUMN_MIGRATIONS) {
            if (!existing.has(migration.column)) {
              await db.execute(migration.ddl);
              logger.info(`[task-repo] additive migration applied: app_tasks.${migration.column}`);
            }
          }
        }
      })();
    }
    await ensured;
  }

  async function existingColumns(): Promise<Set<string>> {
    if (db.dialect === 'pg') {
      const { rows } = await db.query<{ column_name: string }>(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
        ['app_tasks']
      );
      return new Set(rows.map((r) => r.column_name));
    }
    const { rows } = await db.query<{ name: string }>('PRAGMA table_info(app_tasks)');
    return new Set(rows.map((r) => r.name));
  }

  async function selectOne(where: string[], params: unknown[], limit?: number): Promise<Task[]> {
    const sql = `SELECT ${SELECT_COLUMNS} FROM app_tasks${
      where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
    } ORDER BY created_at DESC, id${limit !== undefined ? ` LIMIT ${limit}` : ''}`;
    const { rows } = await db.query<TaskRow>(sql, params);
    return rows.map(toTask);
  }

  return {
    ensureSchema,

    async createTask(input: CreateTaskInput): Promise<Task> {
      await ensureSchema();
      const now = new Date().toISOString();
      const row: TaskRow = {
        id: randomUUID(),
        resource_id: input.resourceId ?? 'default',
        title: input.title,
        description: input.description ?? null,
        status: 'pending',
        priority: input.priority ?? 'medium',
        due_date: input.dueDate ?? null,
        schedule_id: null,
        created_at: now,
        updated_at: now,
        version: 1,
      };
      const params: unknown[] = [
        row.id,
        row.resource_id,
        row.title,
        row.description,
        row.status,
        row.priority,
        row.due_date,
        row.schedule_id,
        row.created_at,
        row.updated_at,
        row.version,
      ];
      const sql = `INSERT INTO app_tasks (id, resource_id, title, description, status, priority, due_date, schedule_id, created_at, updated_at, version)
VALUES (${params.map((_, i) => ph(i)).join(', ')})`;
      await db.execute(sql, params);
      return toTask(row);
    },

    async getTask(id: string): Promise<Task | null> {
      await ensureSchema();
      const tasks = await selectOne([`id = ${ph(0)}`], [id]);
      return tasks[0] ?? null;
    },

    async listTasks(filter: ListTasksFilter = {}): Promise<Task[]> {
      await ensureSchema();
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (clause: (i: number) => string, value: unknown) => {
        where.push(clause(params.length));
        params.push(value);
      };
      if (filter.resourceId !== undefined) add((i) => `resource_id = ${ph(i)}`, filter.resourceId);
      if (filter.status !== undefined) add((i) => `status = ${ph(i)}`, filter.status);
      if (filter.excludeStatus !== undefined)
        add((i) => `status <> ${ph(i)}`, filter.excludeStatus);
      const limit = Math.min(Math.max(Math.floor(filter.limit ?? 20), 1), 100);
      return selectOne(where, params, limit);
    },

    async updateTask(id: string, patch: UpdateTaskPatch): Promise<Task | null> {
      await ensureSchema();
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown) => {
        sets.push(`${column} = ${ph(params.length)}`);
        params.push(value);
      };
      if (patch.title !== undefined) set('title', patch.title);
      if (patch.description !== undefined) set('description', patch.description);
      if (patch.status !== undefined) set('status', patch.status);
      if (patch.priority !== undefined) set('priority', patch.priority);
      if (patch.dueDate !== undefined) set('due_date', patch.dueDate);
      if (patch.scheduleId !== undefined) set('schedule_id', patch.scheduleId);
      if (sets.length === 0) return this.getTask(id);

      sets.push(`updated_at = ${ph(params.length)}`);
      params.push(new Date().toISOString());
      sets.push('version = version + 1');

      let where = `id = ${ph(params.length)}`;
      params.push(id);
      if (patch.expectVersion !== undefined) {
        where += ` AND version = ${ph(params.length)}`;
        params.push(patch.expectVersion);
      }

      const { affectedRows } = await db.execute(
        `UPDATE app_tasks SET ${sets.join(', ')} WHERE ${where}`,
        params
      );
      if (affectedRows === 0) return null;
      return this.getTask(id);
    },

    async attachSchedule(id: string, scheduleId: string): Promise<Task | null> {
      return this.updateTask(id, { scheduleId });
    },
  };
}
