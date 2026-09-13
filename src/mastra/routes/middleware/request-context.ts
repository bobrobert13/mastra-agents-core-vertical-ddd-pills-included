import { MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';
import type { RequestContext } from '@mastra/core/request-context';
import type { Middleware } from '@mastra/core/server';

/** Shape Spec 01's auth provider guarantees on `requestContext.get('user')`. */
interface AuthedUser {
  id?: string;
  roles?: string[];
}

/**
 * GLOBAL `server.middleware` — runs on Hono-served authed routes only. It is
 * SKIPPED for `requiresAuth: false` routes (`skipIfFrameworkPublic`,
 * @mastra/core/dist/server/types.d.ts) — the webhook therefore carries its
 * own route-level limiter + signature guard (spec 08 §3.3).
 *
 * Maps the Spec 01 verified user onto Mastra's memory/resource isolation key.
 * BARE `user.id` — byte-identical to Spec 01's `mapUserToResourceId(user =>
 * user?.id)` so the two writers can never disagree per request (gate finding
 * 08-3: namespaced `user:<id>` is a PROPOSED 01 refinement, not shipped).
 * Never overrides a server-set mapping.
 *
 * `c.get('requestContext')` is typed only on custom-route contexts
 * (`CustomRouteVariables`), so the lookup goes through a narrow cast here.
 */
export const requestContextPopulator: Middleware = async (c, next) => {
  const getContextVar = c.get.bind(c) as unknown as (key: string) => unknown;
  const rc = getContextVar('requestContext') as RequestContext | undefined;

  if (rc && typeof rc.get === 'function' && typeof rc.set === 'function') {
    const user = rc.get('user') as AuthedUser | undefined;
    if (user?.id && !rc.get(MASTRA_RESOURCE_ID_KEY)) {
      rc.set(MASTRA_RESOURCE_ID_KEY, user.id);
    }
  }

  await next();
};
