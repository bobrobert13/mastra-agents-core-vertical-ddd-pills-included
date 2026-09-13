import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { RequestContext } from '@mastra/core/request-context';

import { requestContextPopulator } from '../../../src/mastra/routes/middleware/request-context';

/**
 * Perf bench artifact — spec 08 gate finding 08-5 (the NFR needs a home),
 * following the Spec 06 `security-stack.bench.test.ts` convention:
 * unit-level, in-process, NON-CI-GATED (timing is machine noise; CI machines
 * vary by an order of magnitude). Times N stubbed `app.fetch()` calls with vs
 * without `requestContextPopulator` and records the per-request delta.
 *
 * The Phase 5 "< 5 ms p95" figure is a PROPOSAL until these numbers are
 * reviewed — same convention as Spec 06's NFR-1. The assertion below is a
 * deliberately loose pathological-regression guard, NOT the proposed threshold.
 */

const N = 2000; // N >= 1000 per spec

type HonoMiddleware = Parameters<Hono['use']>[1];

function buildApp(withPopulator: boolean): Hono {
  const app = new Hono();
  // stand-in for the framework glue: requestContext is always present
  app.use('*', (async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set('requestContext', new RequestContext());
    await next();
  }) as unknown as HonoMiddleware);
  if (withPopulator) {
    app.use('*', requestContextPopulator as unknown as HonoMiddleware);
  }
  app.get('/bench', c => c.json({ ok: true }));
  return app;
}

async function timeApp(app: Hono): Promise<number> {
  const request = () =>
    app.fetch(new Request('http://localhost/bench', { method: 'GET' }));
  for (let i = 0; i < 50; i++) await request(); // warm up JIT
  const t0 = performance.now();
  for (let i = 0; i < N; i++) await request();
  return (performance.now() - t0) / N;
}

describe.skipIf(Boolean(process.env.CI))('middleware overhead bench (non-CI)', () => {
  it(`requestContextPopulator per-request delta over ${N} app.fetch() calls`, async () => {
    const without = await timeApp(buildApp(false));
    const withPop = await timeApp(buildApp(true));
    const delta = withPop - without;
    const p95Proxy = Math.max(without, withPop); // per-call mean; p95 needs a histogram — review item

    // eslint-disable-next-line no-console
    console.log(
      `[bench] requestContextPopulator — without: ${without.toFixed(4)} ms/req, ` +
        `with: ${withPop.toFixed(4)} ms/req, delta: ${delta.toFixed(4)} ms/req ` +
        `(PROPOSED bound < 5 ms p95, spec 08 Phase 5; p95-proxy ${p95Proxy.toFixed(4)} ms)`,
    );

    expect(without).toBeGreaterThanOrEqual(0);
    expect(withPop).toBeGreaterThanOrEqual(0);
    // Loose pathological guard only — the real threshold is PROPOSED pending review.
    expect(delta).toBeLessThan(50);
  }, 120_000);
});
