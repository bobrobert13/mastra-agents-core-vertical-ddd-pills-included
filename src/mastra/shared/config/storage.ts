import { PostgresStore } from '@mastra/pg';
import { LibSQLStore } from '@mastra/libsql';
import { LibSQLFeedbackCompatStore } from './libsql-feedback-compat';
import type { ServiceRegistry } from './service-status';

export type Storage = PostgresStore | LibSQLStore;

/**
 * Storage selection (fully optional):
 *   DATABASE_URL (postgres) → PostgreSQL (multi-region only here)
 *   LIBSQL_URL              → LibSQL custom location
 *   nothing                 → LibSQL local file (zero-config dev mode)
 */
export function buildStorage(services: ServiceRegistry): Storage {
  const databaseUrl = process.env.DATABASE_URL;
  const libsqlUrl = process.env.LIBSQL_URL;
  const isMultiRegion = process.env.ENABLE_MULTI_REGION === 'true';

  if (databaseUrl && databaseUrl.startsWith('postgres')) {
    services.push({ name: 'Storage', active: true, detail: 'PostgreSQL (DATABASE_URL)' });
    return buildPostgres(databaseUrl, isMultiRegion, services);
  }

  if (isMultiRegion) {
    services.push({
      name: 'Multi-region',
      active: false,
      detail: 'ignored — requires a PostgreSQL DATABASE_URL',
    });
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

function buildPostgres(
  databaseUrl: string,
  isMultiRegion: boolean,
  services: ServiceRegistry
): PostgresStore {
  if (!isMultiRegion) {
    services.push({
      name: 'Multi-region',
      active: false,
      detail: 'set ENABLE_MULTI_REGION=true to enable',
    });
    return new PostgresStore({ id: 'mastra-storage', connectionString: databaseUrl });
  }

  const primary = process.env.PRIMARY_REGION || 'us-east-1';
  const replica = process.env.SECONDARY_REGION || 'eu-west-1';
  services.push({ name: 'Multi-region', active: true, detail: `${primary} → ${replica}` });

  return new PostgresStore({
    id: 'mastra-storage',
    connectionString: databaseUrl,
    replication: {
      primary,
      replicas: [replica],
      lagThreshold: parseInt(process.env.REPLICATION_LAG_MS || '1000', 10),
    },
  });
}

// LibSQL lacks the feedback tables Postgres implements. LibSQLConfig exposes
// no per-domain override hook, so we build it normally and then swap the
// public observability store for the feedback-compatible shim.
function createLibSQLStorage(id: string, url: string): LibSQLStore {
  const storage = new LibSQLStore({ id, url });
  storage.stores.observability = new LibSQLFeedbackCompatStore({ url });
  return storage;
}
