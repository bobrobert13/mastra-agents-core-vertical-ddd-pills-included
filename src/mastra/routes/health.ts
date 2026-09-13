import { registerApiRoute } from '@mastra/core/server';

/**
 * Version companion to the built-in `GET /health` (the compose healthcheck
 * keeps using the built-in one — untouched). Root-level path: `/api/*` custom
 * routes throw at boot (spec 08 §3.0).
 *
 * Doubles as the Spec 01 read-contract demo: `requestContext.get('user')`
 * exists only when auth verified a token this request — reflects THIS
 * request's auth, no cross-user leak.
 */
export const healthVersionRoute = registerApiRoute('/health/version', {
  method: 'GET',
  requiresAuth: false, // LB / uptime probes hold no JWT; payload is non-sensitive
  handler: async c => {
    const rc = c.get('requestContext');
    const user = rc.get('user') as { id?: string } | undefined;
    return c.json({
      status: 'ok',
      version: process.env.npm_package_version?.trim() || '1.0.0',
      env: process.env.NODE_ENV?.trim() || 'development', // blank ⇒ unset (repo convention)
      user: user?.id ? { id: user.id } : null,
    });
  },
  openapi: { summary: 'Version + env companion probe', tags: ['Health'] },
});
