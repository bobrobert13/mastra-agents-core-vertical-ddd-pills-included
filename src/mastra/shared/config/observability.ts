import { createRequire } from 'module';

import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability';
import type { LogLevel, ObservabilityExporter } from '@mastra/core/observability';
import type { ServiceRegistry } from './service-status';
import { logger } from '../logger'; // spec 08: this module logs the OTLP degrade guidance now

function logLevel(fallback: LogLevel = 'info'): LogLevel {
  return (process.env.LOG_LEVEL as LogLevel) || fallback;
}

/**
 * The standard OTLP env-var convention carries a BASE URL
 * (`http://col:4318`), while `OtelExporter`'s `custom.endpoint` expects the
 * FULL traces URL (`…/v1/traces`, per the exporter docs). Append the path
 * only when the value has none (root ⇒ trailing slash counts as none);
 * anything with a real path is passed through untouched.
 */
export function normalizeTracesUrl(endpoint: string): string {
  const value = endpoint.trim();
  try {
    const url = new URL(value);
    if (url.pathname === '' || url.pathname === '/') {
      url.pathname = '/v1/traces';
      return url.href;
    }
    return value;
  } catch {
    // host:port form (no scheme) — the exporter's default scheme handling
    // applies; append the path when no explicit path is present.
    if (/^[^/\s]+:\d+$/.test(value)) return `http://${value}/v1/traces`;
    return value;
  }
}

/**
 * Observability is on by default (traces go to the configured storage);
 * ENABLE_OBSERVABILITY=false opts out. It never requires extra services.
 *
 * Spec 08 addition (purely additive): `OTEL_EXPORTER_OTLP_ENDPOINT` set ⇒
 * an `OtelExporter` joins the exporter array in BOTH configs. The package is
 * an optional peer — resolved through a guarded SYNC `createRequire` probe so
 * a missing/conflicting install can never block boot, build, or the smoke
 * suite (degrade to storage-only + `○` banner line + WARN). Unset ⇒ the
 * exporter set and banner are byte-identical to today (Scenario 5).
 */
export function buildObservability(services: ServiceRegistry): Observability | undefined {
  if (process.env.ENABLE_OBSERVABILITY === 'false') {
    services.push({
      name: 'Observability',
      active: false,
      detail: 'disabled via ENABLE_OBSERVABILITY=false',
    });
    return undefined; // no OTLP probe on the disabled branch
  }

  services.push({
    name: 'Observability',
    active: true,
    detail: 'traces stored in configured storage (set ENABLE_OBSERVABILITY=false to disable)',
  });

  const exporters: ObservabilityExporter[] = [new MastraStorageExporter()];
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (otlpEndpoint) {
    // Optional peer — never in `dependencies` (no forced deps). The sync probe
    // keeps this builder's signature untouched (no async churn in the root).
    const requireOptional = createRequire(import.meta.url);
    try {
      const { OtelExporter } = requireOptional('@mastra/otel-exporter') as {
        OtelExporter: new (config: {
          provider: { custom: { endpoint: string } };
        }) => ObservabilityExporter;
      };
      const effective = normalizeTracesUrl(otlpEndpoint);
      if (effective !== otlpEndpoint) {
        logger.warn(
          `OTEL_EXPORTER_OTLP_ENDPOINT="${otlpEndpoint}" has no /v1/traces path — ` +
            `the OtelExporter needs the FULL traces URL; exporting to ${effective} instead.`
        );
      }
      exporters.push(new OtelExporter({ provider: { custom: { endpoint: effective } } }));
      services.push({ name: 'OTLP export', active: true, detail: `traces → ${effective}` });
    } catch {
      logger.warn(
        'OTEL_EXPORTER_OTLP_ENDPOINT is set but @mastra/otel-exporter (or its OTLP protocol ' +
          'peer) is not installed — traces stay storage-only. Opt in: ' +
          'npm i @mastra/otel-exporter --legacy-peer-deps'
      );
      services.push({
        name: 'OTLP export',
        active: false,
        detail: 'endpoint set, package missing',
      });
    }
  } else {
    services.push({
      name: 'OTLP export',
      active: false,
      detail: 'set OTEL_EXPORTER_OTLP_ENDPOINT to export',
    });
  }

  return new Observability({
    configs: {
      production: {
        serviceName: process.env.SERVICE_NAME || 'mastra-boilerplate',
        exporters, // array only GROWS — MastraStorageExporter kept in BOTH configs
        spanOutputProcessors: [new SensitiveDataFilter()],
        logging: {
          enabled: process.env.ENABLE_TRACING === 'true',
          level: logLevel(),
        },
      },
      development: {
        serviceName: 'mastra-boilerplate-dev',
        exporters,
        logging: {
          enabled: true,
          level: logLevel('debug'),
        },
      },
    },
    configSelector: () => (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
  });
}
