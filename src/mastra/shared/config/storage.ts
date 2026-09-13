import { PostgresStore } from '@mastra/pg';
import { LibSQLStore } from '@mastra/libsql';
import { LibSQLFeedbackCompatStore } from './libsql-feedback-compat';
import { resolveDbTarget } from './db';
import type { ServiceRegistry } from './service-status';

export type Storage = PostgresStore | LibSQLStore;

/**
 * Storage selection (fully optional). URL precedence lives in ONE place —
 * `resolveDbTarget()` in shared/config/db.ts, shared with the AppDatabase.
 *   DATABASE_URL (postgres) → PostgreSQL
 *   LIBSQL_URL              → LibSQL custom location
 *   nothing                 → LibSQL local file (zero-config dev mode)
 */
export function buildStorage(services: ServiceRegistry): Storage {
  const target = resolveDbTarget();

  if (target.dialect === 'pg') {
    services.push({ name: 'Storage', active: true, detail: 'PostgreSQL (DATABASE_URL)' });
    return new PostgresStore({ id: 'mastra-storage', connectionString: target.url });
  }

  if (process.env.LIBSQL_URL) {
    services.push({
      name: 'Storage',
      active: true,
      detail: `LibSQL (${target.url}) — feedback read-only, set DATABASE_URL for full support`,
    });
    return createLibSQLStorage('mastra-storage', target.url);
  }

  services.push({
    name: 'Storage',
    active: true,
    detail: 'LibSQL local file:./mastra.db — feedback read-only (set DATABASE_URL for PostgreSQL)',
  });
  return createLibSQLStorage('mastra-storage', target.url);
}

// LibSQL lacks the feedback tables Postgres implements. LibSQLConfig exposes
// no per-domain override hook, so we build it normally and then swap the
// public observability store for the feedback-compatible shim.
function createLibSQLStorage(id: string, url: string): LibSQLStore {
  const storage = new LibSQLStore({ id, url });
  storage.stores.observability = new LibSQLFeedbackCompatStore({ url });
  return storage;
}
