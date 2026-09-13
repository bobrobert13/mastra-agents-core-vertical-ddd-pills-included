import { describe, it, expect } from 'vitest';
import { validateEnv, EnvValidationError } from '../../../src/mastra/shared/config/env';

/**
 * NOTE (placement): the source lives in `shared/config/env.ts` but this test
 * rides the Spec 08 wave zone `tests/unit/routes/**` (concurrency rule); the
 * integration pass may move it to `tests/unit/shared/config/env.test.ts`.
 */

describe('validateEnv — fail-fast ONLY on malformed present values', () => {
  it('zero config (nothing set) is always valid', () => {
    expect(() => validateEnv({})).not.toThrow();
    const snapshot = validateEnv({});
    expect(snapshot.port).toBe(4111);
    expect(snapshot.corsOrigins).toEqual([]);
    expect(snapshot.webhookSecretConfigured).toBe(false);
  });

  it('blank/whitespace values count as unset (repo-wide convention)', () => {
    expect(() =>
      validateEnv({ MASTRA_PORT: '', LOG_LEVEL: '   ', CORS_ORIGIN: '', RATE_LIMIT_WINDOW_MS: ' ' })
    ).not.toThrow();
  });

  it('valid realistic env passes and normalizes', () => {
    const snapshot = validateEnv({
      MASTRA_PORT: '4200',
      CORS_ORIGIN: 'https://app.example.com, http://localhost:3000',
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX_REQUESTS: '100',
      WEBHOOK_SECRET: 'whsec_live_value',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://tempo:4318',
      NODE_ENV: 'production', // unconstrained on purpose
      DATABASE_URL: 'anything-here:5432', // not validated — its client owns the error
    });
    expect(snapshot.port).toBe(4200);
    expect(snapshot.corsOrigins).toEqual(['https://app.example.com', 'http://localhost:3000']);
    expect(snapshot.rateLimitWindowMs).toBe(60000);
    expect(snapshot.rateLimitMaxRequests).toBe(100);
    expect(snapshot.webhookSecretConfigured).toBe(true);
    expect(snapshot.otlpEndpoint).toBe('http://tempo:4318');
  });

  it('each malformed var throws an actionable message naming var + value + example', () => {
    const cases: Array<[NodeJS.ProcessEnv, string]> = [
      [{ MASTRA_PORT: 'abc' }, 'MASTRA_PORT="abc"'],
      [{ MASTRA_PORT: '99999' }, 'between 1 and 65535'],
      [{ LOG_LEVEL: 'verbose' }, 'LOG_LEVEL="verbose"'],
      [{ ENABLE_OBSERVABILITY: 'no' }, "only the literal 'false' disables"],
      [{ AUTH_DISABLED: '1' }, 'AUTH_DISABLED="1"'],
      [{ SCOPE_GUARD: 'false' }, 'SCOPE_GUARD="false"'],
      [{ MASTRA_WORKERS: 'scheduler,scheduler2' }, 'MASTRA_WORKERS='],
      [{ CORS_ORIGIN: 'app.example.com' }, 'CORS_ORIGIN="app.example.com"'],
      [{ RATE_LIMIT_WINDOW_MS: '-1' }, 'RATE_LIMIT_WINDOW_MS="-1"'],
      [{ RATE_LIMIT_MAX_REQUESTS: '0' }, 'positive integer'],
      [{ MASTRA_API_PREFIX: 'api' }, 'must start with "/"'],
      [{ MASTRA_STEP_EXECUTION_URL: 'not a url' }, 'MASTRA_STEP_EXECUTION_URL='],
      [{ OTEL_EXPORTER_OTLP_ENDPOINT: 'ftp://collector:4317' }, 'OTLP collector URL'],
    ];
    for (const [env, needle] of cases) {
      let message = '';
      try {
        validateEnv(env);
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        message = (error as Error).message;
      }
      expect(message, `expected "${needle}" in: ${message}`).toContain(needle);
      expect(message).toContain('Every variable in this project is OPTIONAL');
    }
  });

  it('collects ALL issues in one throw (no fix-restart loop)', () => {
    try {
      validateEnv({ MASTRA_PORT: 'x', LOG_LEVEL: 'loud', RATE_LIMIT_MAX_REQUESTS: 'many' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('MASTRA_PORT');
      expect(message).toContain('LOG_LEVEL');
      expect(message).toContain('RATE_LIMIT_MAX_REQUESTS');
    }
  });
});
