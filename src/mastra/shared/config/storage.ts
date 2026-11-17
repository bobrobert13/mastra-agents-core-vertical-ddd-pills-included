// Mastra storage: https://mastra.ai/docs/storage/overview
import { LibSQLStore } from '@mastra/libsql';
import { PostgresStore } from '@mastra/pg';
import { resolveDbTarget } from './db';

export type Storage = PostgresStore | LibSQLStore;

export interface StorageResolution {
  storage: Storage;
  detail: string;
}

export function buildStorage(): StorageResolution {
  const target = resolveDbTarget();
  if (target.dialect === 'pg') {
    return {
      storage: new PostgresStore({ id: 'mastra-storage', connectionString: target.url }),
      detail: 'PostgreSQL (DATABASE_URL)',
    };
  }
  return {
    storage: new LibSQLStore({ id: 'mastra-storage', url: target.url }),
    detail: `LibSQL (${target.url})`,
  };
}
