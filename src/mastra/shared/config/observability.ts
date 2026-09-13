import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability';
import type { LogLevel } from '@mastra/core/observability';
import type { ServiceRegistry } from './service-status';

function logLevel(fallback: LogLevel = 'info'): LogLevel {
  return (process.env.LOG_LEVEL as LogLevel) || fallback;
}

/**
 * Observability is on by default (traces go to the configured storage);
 * ENABLE_OBSERVABILITY=false opts out. It never requires extra services.
 */
export function buildObservability(services: ServiceRegistry): Observability | undefined {
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
