import type { Task, TaskStatus, TaskPriority } from '../entities/task';

/**
 * Repository contracts for the `app_tasks` custom table (ADR-008, spec 05 §3.2).
 * Public surface is unchanged — the barrel re-exports exactly the same names.
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

/** Raw `app_tasks` row as returned by the driver (snake_case, ISO-8601 TEXT dates). */
export interface TaskRow {
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
