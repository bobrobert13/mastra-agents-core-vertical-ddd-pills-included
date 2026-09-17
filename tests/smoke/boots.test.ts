import { describe, it, expect, afterAll, vi } from 'vitest';
import { MastraStorageExporter } from '@mastra/observability';
import { RequestContext } from '@mastra/core/request-context';
import { mastra } from '../../src/mastra';
import { VECTOR_STORE_NAME } from '../../src/mastra/shared/config/vectors';
import { buildServerSurface } from '../../src/mastra/routes';
import type { ApiRoute } from '@mastra/core/server';
import { buildObservability } from '../../src/mastra/shared/config/observability';
import { eventBus } from '../../src/mastra/shared/events';
import type { ServiceRegistry } from '../../src/mastra/shared/config/service-status';

/**
 * Smoke tier: proves the core promise of the boilerplate — the whole Mastra
 * instance constructs successfully with ZERO env vars (no DB, no API keys)
 * and every example domain is registered. Must stay deterministic and
 * offline: no model calls here (that belongs to the evals tier).
 */
describe('Mastra instance smoke', () => {
  it('boots with zero configuration and registers all domain agents', () => {
    const agents = mastra.listAgents();
    expect(Object.keys(agents).sort()).toEqual(['comms', 'files', 'research', 'tasks']);
  });

  it('exposes each agent through getAgent with identity and model resolved', () => {
    for (const name of ['research', 'tasks', 'files', 'comms'] as const) {
      const agent = mastra.getAgent(name);
      expect(agent, `agent "${name}" missing`).toBeDefined();
      expect(agent.id).toMatch(/-agent$/);
      expect(agent.name).toBeTruthy();
      // Model comes from config/model.ts; a string provider/model-id must exist
      // even with no env vars (built-in default), proving agnostic resolution.
      expect(typeof agent.model).toBe('string');
      expect((agent.model as string).length).toBeGreaterThan(0);
    }
  });

  it('has storage configured (env-optional fallback active)', () => {
    expect(mastra.getStorage()).toBeDefined();
  });

  // spec 03 (vectors/RAG/semantic recall) — zero-config boot must expose the
  // vector store + the indexing workflow; the registry reads used by the
  // degrade paths (listVectors/listTools) must never throw.
  it('registers the index-knowledge workflow', () => {
    const workflows = mastra.listWorkflows();
    expect(workflows).toBeDefined();
    expect(Object.keys(workflows!)).toContain('index-knowledge');
  });

  it('exposes the vector store under the mastra-vectors registry name', () => {
    const vectors = mastra.listVectors();
    expect(vectors).toBeDefined();
    expect(Object.keys(vectors!)).toContain(VECTOR_STORE_NAME);
  });

  it('listTools() resolves without throwing (research resolver contract)', () => {
    expect(() => mastra.listTools()).not.toThrow();
  });
});

// ── Spec 08: custom HTTP surface + OTLP regression guard (additive cases,
//    existing assertions above untouched — zero-env, offline, deterministic) ──
describe('Spec 08 HTTP surface (buildServerSurface, zero env)', () => {
  afterAll(() => vi.unstubAllEnvs());

  function zeroConfigSurface() {
    // force the zero-config state regardless of ambient CI env (empty ⇒ unset in this repo)
    for (const key of [
      'CORS_ORIGIN',
      'RATE_LIMIT_WINDOW_MS',
      'RATE_LIMIT_MAX_REQUESTS',
      'WEBHOOK_SECRET',
      'NODE_ENV',
    ]) {
      vi.stubEnv(key, '');
    }
    const services: ServiceRegistry = [];
    return { services, surface: buildServerSurface(services) };
  }

  it('registers exactly the three root-level custom routes with the spec flags', () => {
    const { surface } = zeroConfigSurface();
    const byPath = new Map(surface.apiRoutes.map(r => [r.path, r]));
    expect([...byPath.keys()].sort()).toEqual([
      '/chat/:agentId',
      '/health/version',
      '/hooks/:source',
    ]);

    const webhook = byPath.get('/hooks/:source') as ApiRoute & {
      handler?: unknown;
      middleware?: unknown[];
    };
    const health = byPath.get('/health/version') as ApiRoute & {
      handler?: unknown;
      middleware?: unknown[];
    };
    const chat = byPath.get('/chat/:agentId') as ApiRoute & {
      handler?: unknown;
      middleware?: unknown[];
    };
    expect(webhook.method).toBe('POST');
    expect(health.method).toBe('GET');
    expect(chat.method).toBe('POST');
    expect(webhook.requiresAuth).toBe(false); // HMAC is the auth (Spec 01 JWT does not apply)
    expect(health.requiresAuth).toBe(false); // LB probes
    expect(chat.requiresAuth).not.toBe(false); // default-protected
    // handlers present + per-route middleware on the webhook (global mw is skipped on public routes)
    for (const route of [webhook, health, chat]) expect(route.handler).toBeDefined();
    expect(webhook.middleware).toHaveLength(2); // rate limiter + signature guard
  });

  it('health handler answers the version shape with a minimal stub context', async () => {
    const { surface } = zeroConfigSurface();
    const health = surface.apiRoutes.find(r => r.path === '/health/version') as unknown as {
      handler: (c: unknown) => Promise<unknown>;
    };
    const rc = new RequestContext();
    const stub = {
      get: (key: string) => (key === 'requestContext' ? rc : undefined),
      json: (body: unknown) => body,
    };
    const body = (await health.handler(stub)) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.env).toBe('development'); // NODE_ENV stubbed empty ⇒ fallback
    expect(body.user).toBeNull(); // no authed user on an anonymous probe
  });

  it('webhook middleware chain fail-closes with the exact 401 body when WEBHOOK_SECRET is unset', async () => {
    const { surface } = zeroConfigSurface();
    const publishSpy = vi.spyOn(eventBus, 'publish');
    const webhook = surface.apiRoutes.find(
      r => r.path === '/hooks/:source'
    ) as unknown as ApiRoute & { middleware?: unknown[] };
    const middlewares = (webhook.middleware ?? []) as Array<
      (c: unknown, next: () => Promise<void>) => Promise<unknown>
    >;

    let responded: { body: unknown; status: number } | undefined;
    const stub = {
      req: {
        header: (name: string) =>
          name.toLowerCase() === 'x-webhook-signature' ? 'sha256=00'.padEnd(72, '0') : undefined,
        text: async () => '{"event":"x","data":{}}',
      },
      json: (body: unknown, status?: number) => {
        responded = { body, status: status ?? 200 };
        return new Response(JSON.stringify(body), { status });
      },
      set: () => undefined,
    };
    // the chain is [rate limiter (disabled zero-config ⇒ passthrough), signature
    // guard] — assert the guard itself short-circuits before any handler runs
    const signatureGuard = middlewares[1];
    expect(typeof signatureGuard).toBe('function');
    let ranNext = false;
    await signatureGuard(stub, async () => {
      ranNext = true;
    });
    expect(ranNext).toBe(false);
    expect(responded?.status).toBe(401);
    expect(JSON.stringify(responded?.body)).toBe('{"error":"invalid webhook signature"}');
    expect(publishSpy).not.toHaveBeenCalled(); // Scenario 2: nothing publishes behind a 401
    publishSpy.mockRestore();
  });

  it('banner rows report the new services in BOTH branches (zero-config strings verbatim per §3.7)', () => {
    const { services } = zeroConfigSurface();
    const row = (name: string) => services.find(s => s.name === name);
    expect(row('CORS')).toEqual({
      active: false,
      name: 'CORS',
      detail: "permissive default '*' — set CORS_ORIGIN in production",
    });
    expect(row('Rate limiting')).toEqual({
      active: false,
      name: 'Rate limiting',
      detail: 'disabled (set RATE_LIMIT_WINDOW_MS + RATE_LIMIT_MAX_REQUESTS)',
    });
    expect(row('Webhook signing')).toEqual({
      active: false,
      name: 'Webhook signing',
      detail: 'no WEBHOOK_SECRET — /hooks/* rejects 401',
    });
    // active branch sanity: same three names appear when configured
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');
    vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000');
    vi.stubEnv('RATE_LIMIT_MAX_REQUESTS', '100');
    vi.stubEnv('WEBHOOK_SECRET', 'whsec_smoke');
    const activeServices: ServiceRegistry = [];
    buildServerSurface(activeServices);
    expect(activeServices.find(s => s.name === 'CORS')?.active).toBe(true);
    expect(activeServices.find(s => s.name === 'Rate limiting')?.active).toBe(true);
    expect(activeServices.find(s => s.name === 'Webhook signing')?.active).toBe(true);
  });

  it("buildObservability with OTLP unset keeps today's exporter set byte-stable (Scenario 5)", () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    vi.stubEnv('ENABLE_OBSERVABILITY', '');
    const services: ServiceRegistry = [];
    const observability = buildObservability(services);
    expect(observability).toBeDefined();

    // BOTH configs export to storage ONLY (unset env ⇒ identical content to today)
    const dev = observability!.getInstance('development');
    expect(dev).toBeDefined();
    expect(dev!.getExporters()).toHaveLength(1);
    expect(dev!.getExporters()[0]).toBeInstanceOf(MastraStorageExporter);
    const prod = observability!.getInstance('production');
    expect(prod!.getExporters()).toHaveLength(1);
    expect(prod!.getExporters()[0]).toBeInstanceOf(MastraStorageExporter);

    // OTLP line is additive and inactive (banner gains the new rows, never changes existing ones)
    expect(services.find(s => s.name === 'OTLP export')).toEqual({
      active: false,
      name: 'OTLP export',
      detail: 'set OTEL_EXPORTER_OTLP_ENDPOINT to export',
    });
    expect(services.find(s => s.name === 'Observability')?.active).toBe(true);
  });

  it('the composition root still boots and exposes its server config', () => {
    expect(() => mastra.getServer()).not.toThrow();
  });

  it('MCP: zero-config ⇒ no subprocess, empty tools, no boilerplate server registered', async () => {
    const { loadMcpToolsFor } = await import('../../src/mastra/shared/config/mcp');
    expect(await loadMcpToolsFor('research')).toEqual({});
    expect(Object.keys(mastra.listMCPServers?.() ?? {})).not.toContain('boilerplate');
  });
});
