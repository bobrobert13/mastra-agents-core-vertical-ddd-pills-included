import type { AppDatabase } from '../../../shared/config/db';

export const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS app_tasks (
  id           TEXT PRIMARY KEY,
  resource_id  TEXT NOT NULL DEFAULT 'default',
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL CHECK (status    IN ('pending','in-progress','completed')),
  priority     TEXT NOT NULL CHECK (priority  IN ('low','medium','high')),
  due_date     TEXT,
  schedule_id  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
)`;

export const CREATE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_app_tasks_resource_status ON app_tasks (resource_id, status)';

/** Canonical column projection — keep in sync with {@link CREATE_TABLE_SQL}. */
export const SELECT_COLUMNS =
  'id, resource_id, title, description, status, priority, due_date, schedule_id, created_at, updated_at';

export function createEnsureSchema(db: AppDatabase): () => Promise<void> {
  let ensured: Promise<void> | undefined;
  return async function ensureSchema(): Promise<void> {
    ensured ??= (async () => {
      await db.execute(CREATE_TABLE_SQL);
      await db.execute(CREATE_INDEX_SQL);
    })();
    await ensured;
  };
}
