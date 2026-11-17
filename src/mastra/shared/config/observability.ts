// Mastra observability: https://mastra.ai/docs/observability/overview
import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability';
import type { LogLevel } from '@mastra/core/observability';

function logLevel(fallback: LogLevel = 'info'): LogLevel {
  return (process.env.LOG_LEVEL as LogLevel) || fallback;
}

export function buildObservability(): Observability | undefined {
  if (process.env.ENABLE_OBSERVABILITY === 'false') return undefined;
  const serviceName = process.env.SERVICE_NAME?.trim() || 'mastra-boilerplate';
  return new Observability({
    configs: {
      production: {
        serviceName,
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
        logging: {
          enabled: process.env.ENABLE_TRACING === 'true',
          level: logLevel(),
        },
      },
      development: {
        serviceName: `${serviceName}-dev`,
        exporters: [new MastraStorageExporter()],
        logging: { enabled: true, level: logLevel('debug') },
      },
    },
    configSelector: () => (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
  });
}
