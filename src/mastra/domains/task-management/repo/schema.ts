import type { AppDatabase } from '../../../shared/config/db';
import { logger } from '../../../shared/logger';

/**
 * `app_tasks` schema — DDL, additive migrations and the idempotent bootstrap.
 * The table lives OUTSIDE Mastra's migration system (ADR-008): `ensureSchema()`
 * is additive and idempotent, and Mastra's prune/retention never touches it.
 *
 * Dialect-portability: identical DDL for LibSQL and Postgres (ISO-8601 TEXT
 * timestamps by design); the only per-dialect code is column introspection.
 */

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
  updated_at   TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1
)`;

export const CREATE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_app_tasks_resource_status ON app_tasks (resource_id, status)';

/**
 * Additive column migrations (spec 05 §3.7): future column additions append
 * entries here; each runs only when the column is missing. NEVER destructive
 * — Mastra's init/prune do not know about app tables.
 */
export const ADDITIVE_COLUMN_MIGRATIONS: ReadonlyArray<{ column: string; ddl: string }> = [];

/** Canonical column projection — keep in sync with {@link CREATE_TABLE_SQL}. */
export const SELECT_COLUMNS =
  'id, resource_id, title, description, status, priority, due_date, schedule_id, created_at, updated_at, version';

async function existingColumns(db: AppDatabase): Promise<Set<string>> {
  if (db.dialect === 'pg') {
    const { rows } = await db.query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      ['app_tasks']
    );
    return new Set(rows.map(r => r.column_name));
  }
  const { rows } = await db.query<{ name: string }>('PRAGMA table_info(app_tasks)');
  return new Set(rows.map(r => r.name));
}

/**
 * Build the memoized `ensureSchema()` for a single connection: the first call
 * runs the DDL + pending additive migrations once; every later call awaits the
 * same promise. Idempotent by construction.
 */
export function createEnsureSchema(db: AppDatabase): () => Promise<void> {
  let ensured: Promise<void> | undefined;
  return async function ensureSchema(): Promise<void> {
    if (!ensured) {
      ensured = (async () => {
        await db.execute(CREATE_TABLE_SQL);
        await db.execute(CREATE_INDEX_SQL);
        if (ADDITIVE_COLUMN_MIGRATIONS.length > 0) {
          const existing = await existingColumns(db);
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
  };
}
