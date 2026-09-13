import { createRequire } from 'node:module';
import { createClient, type Client as LibSqlClient, type InValue } from '@libsql/client';
import { logger } from '../logger';

/**
 * AppDatabase — thin connection factory for APPLICATION-owned tables that
 * live inside the SAME database file/URL as Mastra's storage domains
 * (ADR-008, spec 05 §3.1). Mastra's `getStore()` only routes fixed built-in
 * domain keys and `LibSQLStore.client` is private, so custom tables are
 * reached through this dedicated interface, never through the storage
 * adapters.
 */

export type DbDialect = 'libsql' | 'pg';

export interface DbTarget {
  dialect: DbDialect;
  url: string;
}

export interface QueryResult<T> {
  rows: T[];
}

export interface ExecuteResult {
  affectedRows: number;
}

export interface AppDatabase {
  readonly dialect: DbDialect;
  /** SELECT — returns materialized rows. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  /** INSERT / UPDATE / DELETE / DDL — returns the affected-row count. */
  execute(sql: string, params?: readonly unknown[]): Promise<ExecuteResult>;
  close(): Promise<void>;
}

/**
 * Resolve the app database target with the SAME semantics as
 * `buildStorage()` in storage.ts:
 *   DATABASE_URL (postgres…) → pg
 *   LIBSQL_URL               → libsql custom location
 *   nothing                  → libsql local file (zero-config)
 *
 * TODO(spec-05, orchestrator): unify with storage.ts — buildStorage() should
 * call resolveDbTarget() too, so the DATABASE_URL/LIBSQL_URL precedence logic
 * exists exactly once. storage.ts is owned by the composition-root change
 * wave, so this file mirrors its behavior for now.
 */
export function resolveDbTarget(env: NodeJS.ProcessEnv = process.env): DbTarget {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl && databaseUrl.startsWith('postgres')) {
    return { dialect: 'pg', url: databaseUrl };
  }
  if (env.LIBSQL_URL) {
    return { dialect: 'libsql', url: env.LIBSQL_URL };
  }
  return { dialect: 'libsql', url: 'file:./mastra.db' };
}

// --- LibSQL driver ----------------------------------------------------------

function createLibSqlAppDatabase(url: string): AppDatabase {
  const client: LibSqlClient = createClient({ url });
  return {
    dialect: 'libsql',
    // The modern Client interface (not ClientLegacy) exposes execute()/batch():
    // a SELECT's ResultSet carries the rows, a mutation's carries rowsAffected.
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
      const result = await client.execute({ sql, args: params as InValue[] });
      return { rows: result.rows as T[] };
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<ExecuteResult> {
      const result = await client.execute({ sql, args: params as InValue[] });
      return { affectedRows: result.rowsAffected };
    },
    async close(): Promise<void> {
      client.close();
    },
  };
}

// --- Postgres driver ---------------------------------------------------------
// `pg` ships no type declarations and @types/pg is not guaranteed present;
// we access it through createRequire with a minimal structural interface so
// this module compiles either way and libsql-only environments never load pg.

interface PgQueryResultLike {
  rows: unknown[];
  rowCount?: number | null;
}

interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<PgQueryResultLike>;
  end(): Promise<void>;
}

interface PgDriverLike {
  Pool: new (config: { connectionString: string }) => PgPoolLike;
}

const nodeRequire = createRequire(import.meta.url);

function createPgAppDatabase(connectionString: string): AppDatabase {
  const pg = nodeRequire('pg') as PgDriverLike;
  const pool = new pg.Pool({ connectionString });
  return {
    dialect: 'pg',
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
      const result = await pool.query(sql, [...params]);
      return { rows: result.rows as T[] };
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<ExecuteResult> {
      const result = await pool.query(sql, [...params]);
      return { affectedRows: result.rowCount ?? 0 };
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

/** Public factory (test-seamable): build a connection for a target. */
export function createAppDatabase(target: DbTarget): AppDatabase {
  return target.dialect === 'pg'
    ? createPgAppDatabase(target.url)
    : createLibSqlAppDatabase(target.url);
}

// --- Lazy process-wide singleton ---------------------------------------------

let appDbPromise: Promise<AppDatabase | null> | undefined;

/**
 * Env-driven lazy singleton shared by the task tools. Returns null only when
 * the driver itself cannot be constructed (bad URL) — the fallback target
 * (`file:./mastra.db`) always works, mirroring storage's "never absent"
 * guarantee (spec 05 §3.4).
 */
export function getAppDb(): Promise<AppDatabase | null> {
  if (!appDbPromise) {
    appDbPromise = openAppDb();
  }
  return appDbPromise;
}

async function openAppDb(): Promise<AppDatabase | null> {
  const target = resolveDbTarget();
  try {
    return createAppDatabase(target);
  } catch (error) {
    logger.error('[db] failed to open app database connection:', error);
    return null;
  }
}

/**
 * Test seam: drop the cached singleton (next getAppDb() re-resolves env).
 * Never call this while tool executions are in flight.
 */
export function resetAppDb(): void {
  appDbPromise = undefined;
}
