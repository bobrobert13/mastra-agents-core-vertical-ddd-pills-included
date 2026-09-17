import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../../../shared/config/db';
import type { Task } from '../entities/task';
import { SELECT_COLUMNS, createEnsureSchema } from './schema';
import type {
  CreateTaskInput,
  ListTasksFilter,
  TaskRepository,
  TaskRow,
  UpdateTaskPatch,
} from './types';

/** Map a raw driver row onto the `Task` entity (optional fields collapse to `undefined`). */
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

/**
 * `createTaskRepository(db)` — the full CRUD over `app_tasks`, dialect-portable
 * through `db` (`$n` placeholders for pg, `?` for libsql). Schema bootstrap
 * lives in `schema.ts`; the type contracts live in `types.ts`.
 */
export function createTaskRepository(db: AppDatabase): TaskRepository {
  /** `$n` for pg, `?` for libsql; called in param-append order. */
  const ph = db.dialect === 'pg' ? (i: number): string => `$${i + 1}` : (_i: number): string => '?';

  const ensureSchema = createEnsureSchema(db);

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
      if (filter.resourceId !== undefined) add(i => `resource_id = ${ph(i)}`, filter.resourceId);
      if (filter.status !== undefined) add(i => `status = ${ph(i)}`, filter.status);
      if (filter.excludeStatus !== undefined) add(i => `status <> ${ph(i)}`, filter.excludeStatus);
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
