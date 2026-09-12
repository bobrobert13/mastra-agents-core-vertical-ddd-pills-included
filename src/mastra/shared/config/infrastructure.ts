import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability';
import type { LogLevel } from '@mastra/core/observability';
import { PostgresStore } from '@mastra/pg';
import { LibSQLStore } from '@mastra/libsql';
import { LibSQLFeedbackCompatStore } from './libsql-feedback-compat';
import { logger } from '../logger';

export interface ServiceStatus {
  name: string;
  active: boolean;
  detail: string;
}

export interface Infrastructure {
  storage: PostgresStore | LibSQLStore;
  observability?: Observability;
  services: ServiceStatus[];
}

function logLevel(fallback: LogLevel = 'info'): LogLevel {
  return (process.env.LOG_LEVEL as LogLevel) || fallback;
}

// Every infrastructure dependency is optional: if its env var exists it is used,
// otherwise the app falls back gracefully and keeps working (zero-config dev mode).
export function buildInfrastructure(): Infrastructure {
  const services: ServiceStatus[] = [];

  const storage = buildStorage(services);
  const observability = buildObservability(services);
  detectModelProviders(services);

  return { storage, observability, services };
}

// LibSQL lacks the feedback tables Postgres implements. LibSQLConfig exposes
// no per-domain override hook, so we build it normally and then swap the
// public observability store for the feedback-compatible shim.
function createLibSQLStorage(id: string, url: string): LibSQLStore {
  const storage = new LibSQLStore({ id, url });
  storage.stores.observability = new LibSQLFeedbackCompatStore({ url });
  return storage;
}

function buildStorage(services: ServiceStatus[]): PostgresStore | LibSQLStore {
  const databaseUrl = process.env.DATABASE_URL;
  const libsqlUrl = process.env.LIBSQL_URL;
  const isMultiRegion = process.env.ENABLE_MULTI_REGION === 'true';

  if (databaseUrl && databaseUrl.startsWith('postgres')) {
    services.push({ name: 'Storage', active: true, detail: 'PostgreSQL (DATABASE_URL)' });

    if (isMultiRegion) {
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

    services.push({
      name: 'Multi-region',
      active: false,
      detail: 'set ENABLE_MULTI_REGION=true to enable',
    });
    return new PostgresStore({ id: 'mastra-storage', connectionString: databaseUrl });
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

function buildObservability(services: ServiceStatus[]): Observability | undefined {
  if (process.env.ENABLE_OBSERVABILITY === 'false') {
    services.push({
      name: 'Observability',
      active: false,
      detail: 'disabled via ENABLE_OBSERVABILITY=false',
    });
    return undefined;
  }

  services.push({
    name: 'Observability',
    active: true,
    detail: 'traces stored in configured storage (set ENABLE_OBSERVABILITY=false to disable)',
  });

  return new Observability({
    configs: {
      production: {
        serviceName: process.env.SERVICE_NAME || 'mastra-boilerplate',
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
        logging: {
          enabled: process.env.ENABLE_TRACING === 'true',
          level: logLevel(),
        },
      },
      development: {
        serviceName: 'mastra-boilerplate-dev',
        exporters: [new MastraStorageExporter()],
        logging: {
          enabled: true,
          level: logLevel('debug'),
        },
      },
    },
    configSelector: () => (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
  });
}

function detectModelProviders(services: ServiceStatus[]): void {
  const providers: Array<[string, string | undefined]> = [
    ['DeepInfra', process.env.DEEPINFRA_API_KEY],
    ['OpenAI', process.env.OPENAI_API_KEY],
    ['Anthropic', process.env.ANTHROPIC_API_KEY],
    ['Google', process.env.GOOGLE_API_KEY],
  ];

  const available = providers.filter(([, key]) => key && key.trim() !== '').map(([name]) => name);

  services.push({
    name: 'Model providers',
    active: available.length > 0,
    detail:
      available.length > 0
        ? available.join(', ')
        : 'no API keys found — set DEEPINFRA_API_KEY (or another provider key)',
  });
}

export function logServiceAvailability(services: ServiceStatus[]): void {
  const lines = services.map(
    s => `${s.active ? '✅' : '○'} ${s.name.padEnd(16)} ${s.detail}`
  );

  logger.raw(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Mastra Boilerplate — service availability
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Environment: ${process.env.NODE_ENV || 'development'}
${lines.join('\n')}
Agents: research, tasks, files, comms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}
