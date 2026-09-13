import { z } from 'zod';

/**
 * Zod validation of the existing environment variables (spec 08 — accepted
 * deferral of the repo-wide env-validation TODO).
 *
 * Contract (deliberately narrow — the repo's founding promise is
 * "no env var ⇒ no error"):
 *  - ABSENT (or empty/blank) is ALWAYS valid: nothing is required, ever.
 *  - PRESENT but MALFORMED fails fast at boot with an actionable message
 *    naming the variable, showing the bad value and giving a good example.
 *  - Values that are present-but-unrecognized formats for THIS schema are the
 *    only failures — services with their own URL parsers (DATABASE_URL,
 *    REDIS_URL, provider keys) keep their native errors; they are not
 *    duplicated here.
 *
 * Wiring: called from the composition root via `.env`-surface integration
 * (see .artifacts/integration-brief-08.md) BEFORE `buildInfrastructure()`.
 */

export class EnvValidationError extends Error {
  constructor(issues: string[]) {
    super(
      'Invalid environment configuration:\n' +
        issues.map(i => `  - ${i}`).join('\n') +
        '\n\nEvery variable in this project is OPTIONAL: unset (or blank) keeps the ' +
        'matching service inactive and boots clean. Fix the values above or unset them.'
    );
    this.name = 'EnvValidationError';
  }
}

const HTTP_URLS = '(https?://… or *)';

/** String schemas for PRESENT, non-blank values. `.describe`-style messages are inlined. */
const checks: Array<{ key: string; schema: z.ZodType<string>; example: string }> = [
  {
    key: 'MASTRA_PORT',
    schema: z
      .string()
      .regex(/^\d+$/, 'must be a plain integer TCP port between 1 and 65535')
      .refine(
        v => Number(v) >= 1 && Number(v) <= 65535,
        'must be a plain integer TCP port between 1 and 65535'
      ),
    example: 'MASTRA_PORT=4111',
  },
  {
    key: 'LOG_LEVEL',
    schema: z.enum(['debug', 'info', 'warn', 'error']),
    example: 'LOG_LEVEL=info',
  },
  {
    key: 'ENABLE_OBSERVABILITY',
    schema: z.enum(['true', 'false']),
    example: "ENABLE_OBSERVABILITY=false (only the literal 'false' disables)",
  },
  {
    key: 'ENABLE_TRACING',
    schema: z.enum(['true', 'false']),
    example: 'ENABLE_TRACING=true',
  },
  {
    key: 'AUTH_DISABLED',
    schema: z.enum(['true', 'false']),
    example: 'AUTH_DISABLED=true (never in production)',
  },
  {
    key: 'SEMANTIC_RECALL',
    schema: z.enum(['on', 'off']),
    example: 'SEMANTIC_RECALL=off',
  },
  {
    key: 'SCOPE_GUARD',
    schema: z.enum(['on', 'off']),
    example: 'SCOPE_GUARD=off (disables hard scope enforcement — not recommended)',
  },
  {
    key: 'MASTRA_WORKERS',
    schema: z
      .string()
      .regex(
        /^(false|orchestration|scheduler|backgroundTasks)(\s*,\s*(orchestration|scheduler|backgroundTasks))*$/,
        'must be false or a comma-separated list of orchestration|scheduler|backgroundTasks'
      ),
    example: 'MASTRA_WORKERS=scheduler (EXACTLY ONE process may run the scheduler)',
  },
  {
    key: 'CORS_ORIGIN',
    schema: z
      .string()
      .regex(
        /^\s*(\*|https?:\/\/[^\s,]+)(\s*,\s*(\*|https?:\/\/[^\s,]+))*\s*$/,
        `must be comma-separated origins ${HTTP_URLS}`
      ),
    example: 'CORS_ORIGIN=https://app.example.com,https://admin.example.com',
  },
  {
    key: 'RATE_LIMIT_WINDOW_MS',
    schema: z
      .string()
      .regex(/^\d+$/, 'must be a positive integer number of milliseconds')
      .refine(v => Number(v) > 0, 'must be a positive integer number of milliseconds'),
    example: 'RATE_LIMIT_WINDOW_MS=60000',
  },
  {
    key: 'RATE_LIMIT_MAX_REQUESTS',
    schema: z
      .string()
      .regex(/^\d+$/, 'must be a positive integer request count per window')
      .refine(v => Number(v) > 0, 'must be a positive integer request count per window'),
    example: 'RATE_LIMIT_MAX_REQUESTS=100',
  },
  {
    key: 'MASTRA_API_PREFIX',
    schema: z.string().regex(/^\//, 'must start with "/"'),
    example: 'MASTRA_API_PREFIX=/api (only when you customized server.apiPrefix)',
  },
  {
    key: 'MASTRA_STEP_EXECUTION_URL',
    schema: z.string().refine(v => {
      try {
        const url = new URL(v);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'must be a full http(s):// URL'),
    example: 'MASTRA_STEP_EXECUTION_URL=http://api:4111',
  },
  {
    key: 'OTEL_EXPORTER_OTLP_ENDPOINT',
    schema: z.string().refine(v => {
      try {
        // A scheme-less collector address is common (`localhost:4318`) — accept
        // http(s) URLs and host:port; reject everything else.
        if (/^[a-z]+:\/\//i.test(v)) {
          const protocol = new URL(v).protocol;
          return protocol === 'http:' || protocol === 'https:';
        }
        return /^[^:/\s]+:\d+$/.test(v);
      } catch {
        return false;
      }
    }, 'must be an OTLP collector URL (http(s)://host[:port]/v1/traces) or host:port'),
    example: 'OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318',
  },
];

/** Normalized snapshot returned on success (for callers that want typed reads). */
export interface ValidatedEnv {
  port: number;
  corsOrigins: string[];
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
  webhookSecretConfigured: boolean;
  otlpEndpoint?: string;
}

function present(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value === '' ? undefined : value; // blank == unset, everywhere in this repo
}

/**
 * Fail-fast ONLY on malformed present values, never on absence.
 * Throws `EnvValidationError` listing every offending variable at once.
 */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): ValidatedEnv {
  const issues: string[] = [];

  for (const check of checks) {
    const value = present(env, check.key);
    if (value === undefined) continue;
    const result = check.schema.safeParse(value);
    if (!result.success) {
      const reason = result.error.issues[0]?.message ?? 'invalid value';
      issues.push(`${check.key}="${value}" — ${reason}. Example: ${check.example}`);
    }
  }

  if (issues.length > 0) throw new EnvValidationError(issues);

  const rateWindow = present(env, 'RATE_LIMIT_WINDOW_MS');
  const rateMax = present(env, 'RATE_LIMIT_MAX_REQUESTS');

  return {
    port: Number(present(env, 'MASTRA_PORT') ?? '4111'),
    corsOrigins: (present(env, 'CORS_ORIGIN') ?? '')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean),
    ...(rateWindow && { rateLimitWindowMs: Number(rateWindow) }),
    ...(rateMax && { rateLimitMaxRequests: Number(rateMax) }),
    webhookSecretConfigured: present(env, 'WEBHOOK_SECRET') !== undefined,
    ...(present(env, 'OTEL_EXPORTER_OTLP_ENDPOINT') && {
      otlpEndpoint: present(env, 'OTEL_EXPORTER_OTLP_ENDPOINT'),
    }),
  };
}
