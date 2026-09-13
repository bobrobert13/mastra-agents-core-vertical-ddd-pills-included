# ADR-004: Server & Studio Authentication (JWT-first, fail-fast in production)

## Status

Accepted

## Context

`docs/PRODUCTION-GAP-ANALYSIS.md` §2.1 (priority #1) and §1.3: the boilerplate shipped **no authentication at all** — `new Mastra({ server: { port, host } })` exposes every built-in `/api/*` route (agent execution, workflow runs, tools) and the whole Studio UI to anyone who can reach the port. The HA production compose publishes 3 API replicas, so a single reachable host meant anonymous code execution. `MASTRA_JWT_SECRET` existed in `.env.example:63` but was read by nothing: dead config that gave a false sense of security.

The fix has to respect the repo's hard rule — **no env var ⇒ no error, the service is simply inactive** — while closing the production hole. `npm run dev` with zero env vars must still boot as fast as before; a production deployment must not be able to come up open by accident.

`@mastra/core` 1.66.0 gives a real slot for this: `ServerConfig.auth?: MastraAuthConfig<any> | IMastraAuthProvider<any>` (`@mastra/core/dist/server/types.d.ts:361`), with middleware defaults that already protect `["/api/*"]` and keep `["/api","/api/auth/*"]` public (`@mastra/server/dist/helpers-610L0lwQ.js:5-6`).

## Options Considered

### Option 1: Built-in JWT provider (`@mastra/auth` → `MastraJwtAuth`)

- Pros: official documented path (`docs/auth/jwt`); Studio login supported; signature **and** expiry verified locally (constant-time inside `jsonwebtoken`); one env var activates everything; supports the Studio-capable provider list.
- Cons: one extra dependency (`@mastra/auth`, which pulls `jsonwebtoken` + `jwks-rsa`) and `package-lock.json` churn; CI must keep `npm_config_legacy_peer_deps=true`.

### Option 2: Zero-dep `MastraAuthConfig` with a hand-rolled `authenticateToken` using `jose`

- Pros: no new `@mastra/*` package.
- Cons: `jose` is only present **transitively** today (via `@a2a-js/sdk`) — using it means promoting it to a direct dep anyway, and it puts hand-written crypto (and any raw token comparison, which would need `crypto.timingSafeEqual`) where a maintained provider exists. Boilerplate-owned crypto is a liability, not a saving.

### Option 3: `SimpleAuth` (token map / email+password) as the default

- Pros: gives Studio a real login screen out of the box.
- Cons: static token/user table is a dev/demo mechanism; making it the production default would advertise the wrong posture. Kept instead as the **worker** token mechanism inside a `CompositeAuth`.

### Option 4: Third-party providers (Clerk/Auth0/WorkOS/…) as the default

- Rejected as anti-filler (gap analysis §4): the boilerplate must not pull an SDK nobody asked for. Only a documented extension point ships (below).

### Option 5: Warn instead of exiting when production has no auth

- Rejected: a warning is skippable; the "0 public production deployments" gate needs a non-zero exit.

## Decision

`src/mastra/shared/config/auth.ts` exports `buildAuth(services): AuthConfig | undefined`, mirroring the `buildObservability()` env-optional builder pattern, wired once in `buildInfrastructure()` and spread into `server` like `observability` (`...(auth && { auth })`).

Selection order:

1. `AUTH_DISABLED=true` → explicit, **loudly logged** opt-out; also skips the production fail-fast. Banner: `EXPLICITLY DISABLED via AUTH_DISABLED=true — do not ship to prod`.
2. `AUTH_PROVIDER` set → **fatal**: `clerk|supabase|auth0|workos|firebase|okta|better-auth|google` are documented extension points ("not wired yet"), anything else is "unrecognized". No provider SDK is pulled in this phase.
3. `MASTRA_JWT_SECRET` set → `new MastraJwtAuth({ secret, mapUserToResourceId })`. If `MASTRA_WORKER_AUTH_TOKEN` is also set, the JWT provider is wrapped in `CompositeAuth([MastraJwtAuth, SimpleAuth({ tokens: { [workerToken]: { id: 'mastra-worker' } } })])` so the HA worker can post its bearer token to the two `requiresAuth: true` endpoints (`POST /api/workflows/:id/runs/:runId/steps/execute`, `POST /api/workflows/events`). Spec 02 only passes the env vars through compose; the names are the fixed contract.
4. Nothing set + `NODE_ENV=production` → `logger.error(FATAL…)` + `process.exit(1)` before the server binds. The message names both `MASTRA_JWT_SECRET` and the `AUTH_DISABLED=true` escape hatch and points here.
5. Nothing set + dev → `undefined` (no `auth` key at all) **plus** the loud banner line `⚠️  Server is UNAUTHENTICATED — every /api/* route and Studio are public. Set MASTRA_JWT_SECRET before deploying.` and one `Auth` status row (`○ Auth  NONE — public. set MASTRA_JWT_SECRET for production`).

`protected`/`public` are **not** overridden: Mastra's defaults already match this server. They are rewritten (`["<prefix>/*"]` / `[prefix, "<prefix>/auth/*"]` + `logger.warn`) only if a custom `server.apiPrefix` is ever introduced, because the defaults stop matching then.

`mapUserToResourceId` is always set (`id ?? sub`): without it Mastra logs a startup warning and ownership checks trust the caller, which would defeat memory/thread isolation.

## Consequences

### Positive

- Zero-config `npm run dev` is unchanged apart from one extra warning line; the smoke boot test stays green untouched.
- An unconfigured production instance never serves traffic — fail-fast at boot beats fail-open at runtime.
- Studio gains a login path (JWT is a Studio-capable provider: Simple Auth, JWT, WorkOS, Better Auth, Google); operators authenticate via Settings → Headers → `Authorization: Bearer <jwt>`.
- Every built-in `/api/*` route returns `401 {"error":"Invalid or expired token"}` to anonymous callers; JWT expiry is enforced by the same path.
- Auth adds **no** new upstream dependency: verification is local HMAC crypto, and the inert path returns in O(1) (no boot-time network call).

### Negative

- Anyone running a production build today with no auth now gets a boot they didn't have before (breaking change by design).
- Root `/health` stays **public** — auth protects `/api/*`, not every path.
- Rotating `MASTRA_JWT_SECRET` invalidates every outstanding JWT at once and there is no revocation list in the built-in provider.
- `@mastra/auth` adds a dependency that Renovate must keep in lockstep with `@mastra/core`.

### Mitigations

- The fatal message is actionable and lists the escape hatch; `.env.example` + README lead with the one-line fix; `docker-compose.prod.yml` already passes `MASTRA_JWT_SECRET`.
- `/health → 200` unauthenticated is **asserted by tests** so the compose/k8s healthcheck contract is pinned, not incidental; any new root-level route is public by default and must be moved under the protected prefix or given `requiresAuth` explicitly.
- Rotation procedure: publish the new secret via env, roll the containers (`docker compose -f docker-compose.prod.yml up -d`), and keep signed JWTs short-lived (`exp` is enforced); use a **different** `MASTRA_WORKER_AUTH_TOKEN` per worker type and TLS in front of the API (per `docs/auth/workers` security recommendations).
- No hand-rolled secret comparison exists in this code path (`MastraJwtAuth` / `SimpleAuth` do it), so the `crypto.timingSafeEqual` NFR is **N/A-by-choice** — documented rather than implemented.

## Related

- Resolves `docs/PRODUCTION-GAP-ANALYSIS.md` §1.3 + §2.1.
- Spec: `docs/specs/01-auth-server-studio.md`. Blocks: Spec 02 (worker token passthrough), Spec 04 (MCP).
- Implementation: `src/mastra/shared/config/auth.ts` · tests: `tests/unit/shared/config/auth.test.ts`.
