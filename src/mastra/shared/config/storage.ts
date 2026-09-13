import { PostgresStore } from '@mastra/pg';
import { LibSQLStore } from '@mastra/libsql';
import { LibSQLFeedbackCompatStore } from './libsql-feedback-compat';
import type { ServiceRegistry } from './service-status';

export type Storage = PostgresStore | LibSQLStore;

/**
 * Storage selection (fully optional):
 *   DATABASE_URL (postgres) → PostgreSQL
 *   LIBSQL_URL              → LibSQL custom location
 *   nothing                 → LibSQL local file (zero-config dev mode)
 */
export function buildStorage(services: ServiceRegistry): Storage {
  const databaseUrl = process.env.DATABASE_URL;
  const libsqlUrl = process.env.LIBSQL_URL;

  if (databaseUrl && databaseUrl.startsWith('postgres')) {
    services.push({ name: 'Storage', active: true, detail: 'PostgreSQL (DATABASE_URL)' });
    // TODO(orchestrator): unify URL resolution with shared/config/db.ts
    return new PostgresStore({ id: 'mastra-storage', connectionString: databaseUrl });
  }

  if (libsqlUrl) {
    services.push({
      name: 'Storage',
      active: true,
      detail: `LibSQL (${libsqlUrl}) — feedback read-only, set DATABASE_URL for full support`,
    });
    return createLibSQLStorage('mastra-storage', libsqlUrl);
  }

  services.push({
    name: 'Storage',
    active: true,
    detail: 'LibSQL local file:./mastra.db — feedback read-only (set DATABASE_URL for PostgreSQL)',
  });
  return createLibSQLStorage('mastra-storage', 'file:./mastra.db');
}

// LibSQL lacks the feedback tables Postgres implements. LibSQLConfig exposes
// no per-domain override hook, so we build it normally and then swap the
// public observability store for the feedback-compatible shim.
function createLibSQLStorage(id: string, url: string): LibSQLStore {
  const storage = new LibSQLStore({ id, url });
  storage.stores.observability = new LibSQLFeedbackCompatStore({ url });
  return storage;
}
