# Spec+: Auth — Server & Studio (Phase 1)

| Field | Value |
|---|---|
| **Spec id** | 01 |
| **Phase** | 1 (execution order per `docs/PRODUCTION-GAP-ANALYSIS.md` §5) |
| **Depends on** | none |
| **Blocks** | Spec 02 (Distributed PubSub & Workers — worker token auth contract); MCP (Spec 04) |
| **Status** | DRAFT |
| **Resolves** | `docs/PRODUCTION-GAP-ANALYSIS.md` §1.3 (dead `MASTRA_JWT_SECRET`), §2.1 (Server & Studio auth — priority #1) |
| **Grounded on** | `@mastra/core` 1.66.0 + `mastra` 1.29.0; docs [Auth overview](https://mastra.ai/docs/auth/overview), [JWT](https://mastra.ai/docs/auth/jwt), [Workers auth](https://mastra.ai/docs/auth/workers) |

---

## Phase 1: Strategic Vision

* **Vision:** A platform engineer who clones the boilerplate ships an instance where **no `/api/*` route and no Studio screen is reachable by an anonymous caller in production unless they deliberately opted out** — while `npm run dev` with zero env vars boots as fast as today, with one added warning line.

* **OKR / Goal** (`PROPOSAL`):
  1. **(primary, recommended)** **0 public production deployments possible without an explicit opt-out**: in `@mastra/core` terms, an instance booted with `NODE_ENV=production` and no auth configured is **refused at startup** (non-zero exit), proven by a smoke/unit test. This kills the §2.1 finding — *"the production HA deployment exposes agent/workflow execution to whoever reaches the port."*
  2. **(secondary)** **100% of built-in `/api/*` routes return `401` without credentials** on a JWT-configured instance — asserted by an acceptance test that walks `/api/agents`, `/api/workflows`, `/api/tools` (the real protected pattern is `["/api/*"]`, `@mastra/server/dist/helpers-610L0lwQ.js:5`).
  3. **(guard-rail)** **zero-config dev boot-time regression < 1s** and the existing `tests/smoke/boots.test.ts` stays green unchanged (`tests/smoke/boots.test.ts:2` imports the live `mastra` instance with no env).

## Phase 2: Functional Spec (BDD)

* **User Story:** As a **platform engineer cloning the boilerplate**, I want authentication on the API and Studio to activate from a single env var and to *refuse* to run open in production, so that I can deploy the compose HA stack without a manual security pass and still `npm run dev` with no config.

### Acceptance Criteria

* **Scenario 1: Happy path — JWT configured**
  * **Given** `MASTRA_JWT_SECRET` is set to a non-empty string and `NODE_ENV=production`
  * **When** the Mastra instance is constructed and a `GET /api/agents` request arrives carrying `Authorization: Bearer <jwt signed with MASTRA_JWT_SECRET>`
  * **Then** the route handler runs and returns `200` with the agent list (auth resolves the principal).

* **Scenario 2: Production without auth refuses to boot (fail-fast)**
  * **Given** `NODE_ENV=production` and neither `MASTRA_JWT_SECRET` nor a recognized `AUTH_PROVIDER` is set, and `AUTH_DISABLED` is not set to `true`
  * **When** `buildAuth()` runs during `buildInfrastructure()`
  * **Then** the process exits before the server binds, printing exactly:
    `FATAL [auth]: NODE_ENV=production but no auth is configured. Set MASTRA_JWT_SECRET (built-in JWT) or AUTH_PROVIDER=<clerk|supabase|auth0|workos|firebase|okta|better-auth|google>. For a deliberate, documented opt-out set AUTH_DISABLED=true. See docs/adr/004-auth-server-studio.md.`
    (`logger.error` + `process.exit(1)`; never a silent boot.)

* **Scenario 3: Dev without auth boots with a loud banner line**
  * **Given** `NODE_ENV` is unset (or `development`) and no auth env is present and `AUTH_DISABLED` is not `true`
  * **When** the server boots
  * **Then** it starts unauthenticated **and** the service-availability banner carries an extra warning line (see Phase 3, banner):
    `⚠️  Server is UNAUTHENTICATED — every /api/* route and Studio are public. Set MASTRA_JWT_SECRET before deploying.`

* **Scenario 4: Auth failure on an `/api` route returns the real Mastra 401 shape**
  * **Given** an instance configured with built-in JWT auth (`MASTRA_JWT_SECRET` set)
  * **When** a `GET /api/agents` request arrives with **no** `Authorization` header, or with a token that fails verification
  * **Then** the server responds `401` with body `{"error":"Invalid or expired token"}` — the verbatim shape emitted by Mastra's auth middleware (`@mastra/server/dist/helpers-610L0lwQ.js:229-230`), status from `:289-290`.

* **Scenario 5: Studio login flow**
  * **Given** built-in JWT (or a Studio-capable provider — see `docs/auth/overview`: Studio login is supported by **Simple Auth, JWT, WorkOS, Better Auth, Google**) is configured and Studio is served at `/`
  * **When** an operator opens Studio without a session
  * **Then** Studio shows a login screen and calls `GET /api/auth/capabilities` (public, in the default `public` list `["/api","/api/auth/*"]` — `helpers-610L0lwQ.js:6`) to render the available login method; once the operator supplies a token (`Authorization: Bearer <jwt>` — Studio → Settings → Headers → Add Header), subsequent `/api/*` calls from Studio are authenticated.

> **Explicitly out of scope for Phase 2 scenarios:** third-party provider *behavior* (only the `AUTH_PROVIDER` wiring switch exists — see Phase 3). Fine-grained authorization is a doc pointer only (§2.1), never implemented here.

## Phase 3: Technical Contract & DoD

* **Interface / Data Schema:**

  The real `server.auth` slot is typed (`@mastra/core/dist/server/types.d.ts:361`):
  `auth?: MastraAuthConfig<any> | IMastraAuthProvider<any>` inside `ServerConfig` (`:200`).
  `MastraAuthConfig` (`@internal_auth/dist/types/index.d.ts:20`) is `{ protected?, public?, authenticateToken?, authorize?, mapUserToResourceId?, rules? }`.

  Mirror the `buildObservability(services): Observability | undefined` pattern (`src/mastra/shared/config/observability.ts:13`) — a builder that takes the `ServiceRegistry`, pushes a `ServiceStatus` in **both** active and inactive branches, and returns `undefined` when inert. The auth value is then spread into `server` the same way `observability` is spread today (`src/mastra/index.ts:26`).

  ```typescript
  // src/mastra/shared/config/auth.ts
  import type { MastraAuthConfig, IMastraAuthProvider } from '@mastra/core/server';
  import type { ServiceRegistry } from './service-status';

  /** The real union `new Mastra({ server: { auth } })` accepts in 1.66.0. */
  export type AuthConfig = MastraAuthConfig<any> | IMastraAuthProvider<any>;

  /**
   * Auth selection (env-optional, fail-fast in production):
   *   MASTRA_JWT_SECRET            → built-in JWT (MastraJwtAuth / native verify)
   *   AUTH_PROVIDER=<name>         → third-party integration wiring switch (extension point only)
   *   AUTH_DISABLED=true           → explicit, logged opt-out (dev or a deliberate exception)
   *   nothing + NODE_ENV=production→ FATAL exit(1) (actionable error, Scenario 2)
   *   nothing + dev                → undefined (inert) + loud banner warning (Scenario 3)
   * The value returned is dropped straight into `server.auth`; `undefined` = no auth key.
   */
  export function buildAuth(services: ServiceRegistry): AuthConfig | undefined {
    // ...
  }
  ```

  Built-in JWT branch (the `@mastra/auth` class, `docs/auth/jwt`):
  ```typescript
  import { MastraJwtAuth } from '@mastra/auth';
  new MastraJwtAuth({
    secret: process.env.MASTRA_JWT_SECRET,
    // Set a mapper: without one Mastra logs a startup warning and ownership
    // checks trust the caller (reference-configuration:639 / middleware docs).
    mapUserToResourceId: (user: { id?: string }) => user?.id,
  });
  ```
  `@mastra/auth` is **not currently a dependency** (verified: `node_modules/@mastra/auth` absent; `package.json` deps list has core/evals/libsql/memory/observability/pg/mastra/zod). Adding it requires `npm install @mastra/auth@1 --legacy-peer-deps` (root `AGENTS.md` gotcha #1) and committing `package-lock.json` (CI uses `npm ci`). **Fallback if the extra package is undesirable:** build a plain `MastraAuthConfig` with `authenticateToken` (the slot is real — `@internal_auth/dist/types/index.d.ts:32`) doing HS256 verification with `jose`. **Caveat:** `jose@6.2.12` is present in the tree only *transitively* (via `@a2a-js/sdk`), and the `@mastra/auth` registry package itself uses `jsonwebtoken` + `jwks-rsa`, not `jose` — so if the fallback is chosen, promote `jose` to a direct dependency; do not rely on the transitive copy. The builder returns the same `AuthConfig` union either way, so this choice is swappable behind `buildAuth`.

  **`AUTH_PROVIDER` wiring switch (extension point — wiring only, no providers implemented):**
  ```typescript
  const PROVIDERS = ['clerk','supabase','auth0','workos','firebase','okta','better-auth','google'] as const;
  // AUTH_PROVIDER unset → fall through to JWT/banner logic.
  // AUTH_PROVIDER set to a known value → throw the "not wired yet" actionable error:
  //   FATAL [auth]: AUTH_PROVIDER="clerk" is a documented extension point, not shipped in
  //   this phase. Integrate its provider package and return it from buildAuth().
  //   See docs/auth/overview third-party list. (Unknown value → same fatal shape, "unrecognized".)
  ```
  The switch documents *where* a provider plugs in (`server.auth` / `studio.auth`) without pulling any provider SDK — per §4 anti-filler, "third-party auth providers as the default" do **not** belong.

  **Env vars table:**

  | Env var | Effect | Inactive / unset |
  |---|---|---|
  | `MASTRA_JWT_SECRET` | Activates built-in JWT auth (Studio login + all `/api/*` protected). **Resurrects the currently-dead var at `.env.example:63`.** | skipped unless set |
  | `AUTH_PROVIDER` | `clerk\|supabase\|auth0\|workos\|firebase\|okta\|better-auth\|google` → wiring switch (extension point, fatal "not wired" today) | inert; JWT/banner path runs |
  | `AUTH_DISABLED` | `true` = explicit opt-out of auth **and** of the production fail-fast; logged loudly, never silent | defaults unset |
  | `MASTRA_WORKER_AUTH_TOKEN` | **Worker bearer token** accepted on the step-execution + event endpoints (contract consumed by Spec 02 — see below). The env name is fixed here; Spec 01 reads it only to wire the provider — compose passthrough is owned by Spec 02. | inert in single-process dev |
  | `NODE_ENV` | `production` triggers the fail-fast when no auth & no `AUTH_DISABLED` | any other value = permissive dev |
  | `MASTRA_API_PREFIX` *(only if a custom `server.apiPrefix` is ever introduced)* | when set, `protected`/`public` must be rewritten — see apiPrefix warning | not set today |

  **Banner (extend `service-status.ts:13-23` `logServiceAvailability`, format `${active?'✅':'○'} ${name.padEnd(16)} ${detail}`):** `buildAuth` pushes exactly one `ServiceStatus` line, e.g.:
  * JWT active → `{ name:'Auth', active:true, detail:'JWT (MASTRA_JWT_SECRET) — /api/* + Studio protected' }`
  * inert dev → `{ name:'Auth', active:false, detail:'NONE — public. set MASTRA_JWT_SECRET for production' }` **plus** a dedicated `⚠️` warning line (Scenario 3) rendered above the table.
  * `AUTH_DISABLED=true` → `{ name:'Auth', active:false, detail:'EXPLICITLY DISABLED via AUTH_DISABLED=true — do not ship to prod' }`

  **Protected / public defaults + apiPrefix handling:** Do **not** override `protected`/`public` when `server.apiPrefix` is unset — Mastra's defaults (`helpers-610L0lwQ.js:5-6`) already protect `["/api/*"]` and keep `["/api","/api/auth/*"]` public, and leave root **`/health` public** (the `/health` route is at root, outside `/api/*` — verified `dist-4Qm6OSPJ.js` `/health` fetch + `README.md:67` `GET /health → {"success":true}`), which is exactly what the prod healthcheck depends on (`docker-compose.prod.yml:51`). **apiPrefix warning** (`docs/auth/overview`): *"when you set a custom `server.apiPrefix`, those defaults no longer match and built-in routes fall outside the protected pattern."* Therefore the builder must, if a prefix is configured, set `auth.protected = [\`${prefix}/*\`]` and `auth.public = [prefix, \`${prefix}/auth/*\`]` and emit a `logger.warn` naming the change. Today no prefix is set (`src/mastra/index.ts:27-30` only sets `port`/`host`), so this is a guard, not a live path.

  **Worker token contract (consumed by Spec 02 — env names only):** With auth configured, the two worker endpoints are `requiresAuth: true` (`docs/auth/workers`): `POST /api/workflows/:workflowId/runs/:runId/steps/execute` and `POST /api/workflows/events`. The orchestration worker sends `MASTRA_WORKER_AUTH_TOKEN` as `Authorization: Bearer <token>` via `HttpRemoteStrategy`. **Spec 01 must make the server's provider recognize that bearer token** and **Spec 02 only passes the two env vars through compose** (`docs/specs/02-...:170,178-179` confirm this split). The recommended server shape is `CompositeAuth` (`@mastra/core/server`, exported `server/index.d.ts:11`) combining the JWT provider with a `SimpleAuth` token-map (`server/index.d.ts:13`, `SimpleAuthOptions.tokens` `@internal_auth/dist/provider/index.d.ts:123`) keyed by `MASTRA_WORKER_AUTH_TOKEN`. Whether the worker reuses the JWT secret or a separate `SimpleAuth` token is a Phase 4 open question; the env names above are the fixed contract.

  **Wiring in `infrastructure.ts` (`:22-30`) and `index.ts` (`:15-31`):**
  ```typescript
  // infrastructure.ts — add one call, keep the file ~40 lines (shared/AGENTS.md rule)
  const auth = buildAuth(services);
  return { storage, observability, auth, services };
  // index.ts — mirror the observability spread
  server: {
    port: ..., host: ...,
    ...(auth && { auth }),
  },
  ```

* **Estimated Impact (estimate, grounded in `codegraph impact` + files read):** ~350–400 LOC (excluding `package-lock.json` churn) across ~11 files, in **one** commit (inside the 400–800 staged-LOC guardrail). *Note:* `package-lock.json` regeneration is exempt from the LOC guardrail — measured churn there is dependency-tree noise, not authored code:
  * `src/mastra/shared/config/auth.ts` — **new**, ~90–130 LOC (builder + env read + banner status + fatal paths). Blast radius: 1 caller (`buildInfrastructure`, `infrastructure.ts:22`).
  * `src/mastra/shared/config/infrastructure.ts` — ~+6 LOC (`:22-30`).
  * `src/mastra/index.ts` — ~+4 LOC (spread `auth` into `server`, `:27-30`).
  * `.env.example` — ~+14 LOC (activate `MASTRA_JWT_SECRET:63`, add `AUTH_PROVIDER`, `AUTH_DISABLED`, `MASTRA_WORKER_AUTH_TOKEN`).
  * `README.md` — ~+25 LOC (new "🔐 Auth" quickstart section; extend env-optional service table at `:104-113`).
  * `AGENTS.md` (root) — ~+10 LOC (add `Auth` row to the service table, add a gotcha entry: "auth protects `/api/*` + Studio but **not** root `/health`; custom `apiPrefix` needs protected/public rewritten").
  * `docs/adr/004-auth-server-studio.md` — **new** ADR, ~60 LOC (numbered next after ADR-003; never edit ADR-002, which may be referenced later per repo rules).
  * `package.json` + `package-lock.json` — `@mastra/auth` dependency (or zero-dep `jose` fallback).
  * Tests: `tests/unit/shared/config/auth.test.ts` (~120 LOC), smoke addition (~15 LOC).
  (`ServiceRegistry`/`ServiceStatus` — `service-status.ts:4,11` — have ⚠️ **no covering tests** per `codegraph explore`; the new unit test is the first coverage on the registry contract.)

* **Definition of Done (DoD):**
  - [ ] Acceptance criteria (Scenarios 1–5) covered by **unit** tests (`tests/unit/shared/config/auth.test.ts`: JWT active returns an `AuthConfig`; no-env-in-prod exits 1 with the exact Scenario-2 string; no-env-in-dev returns `undefined` + pushes the warning status; `AUTH_DISABLED` returns `undefined` + warning).
  - [ ] Acceptance criteria covered by **smoke** test: existing `tests/smoke/boots.test.ts` still green with zero env, and a new smoke case asserts a JWT-configured instance exposes `server.auth` (boot-time, not model-call — keep smoke offline per `tests/AGENTS.md`).
  - [ ] **Payload validation**: an acceptance test walks the built-in protected routes (`/api/agents`, `/api/workflows`, `/api/tools`) and asserts **`401 {"error":"Invalid or expired token"}`** without credentials and `200` with a valid bearer — matching the real middleware shape (`helpers-610L0lwQ.js:229-230,289-290`).
  - [ ] **`/health` stays `200` unauthenticated** (regression guard on the compose healthcheck, `docker-compose.prod.yml:51`).
  - [ ] Docs updated: root **`AGENTS.md`** service table row (`Auth` activated by `MASTRA_JWT_SECRET`) **and** a new **gotcha** entry (health not protected; apiPrefix caveat; Studio-capable providers list); **`README.md`** auth quickstart; **`.env.example`** comments (JWT + AUTH_PROVIDER + AUTH_DISABLED + MASTRA_WORKER_AUTH_TOKEN); new **`docs/adr/004-auth-server-studio.md`** (do not edit accepted ADR-002; add a pointer only if relevant). `docs/adr/README.md` index line appended.
  - [ ] Worker token contract documented for Spec 02 (env names `MASTRA_WORKER_AUTH_TOKEN` + `MASTRA_STEP_EXECUTION_URL`, endpoints, `CompositeAuth`/`SimpleAuth` recommendation).
  - [ ] `npm run test:all` green (smoke → unit → integration → evals) and `npx tsc --noEmit` clean and `npm run lint` 0/0.
  - [ ] `timeout 15 npm run dev` with **zero** env still boots and prints the loud `⚠️ UNAUTHENTICATED` banner line (Scenario 3 verified by hand — browser/Studio verification left to the user).
  - [ ] No compose edits in this spec — `MASTRA_WORKER_AUTH_TOKEN` passthrough into `docker/docker-compose.prod.yml` is owned by Spec 02 (per the split at `docs/specs/02-...:170,178-179`); Spec 01 only fixes the env name + reads it to wire the provider.
  - [ ] Work on a branch named **`feat/auth-server-studio`** (root `AGENTS.md`: `feat/<slug>`).
  - [ ] Commits staged every 400–800 LOC; never exceed 1400 LOC per commit; Conventional Commits (`feat: ...`).
  - [ ] Business and UI tests written where applicable; manual Studio/browser login verification (Scenario 5) left to the user.

## Phase 4: Risks & Open Questions

* **Risks (max 3, real, each with a mitigation):**
  1. **Breaks existing zero-config users who run production builds.** Anyone today doing `NODE_ENV=production node .mastra/output/index.mjs` with no auth (e.g. the prod image, `docker/Dockerfile`) will hit the new fail-fast and see a boot they didn't before. **Mitigation:** the fatal error is actionable and names both `MASTRA_JWT_SECRET` and the `AUTH_DISABLED=true` escape hatch; the ADR (`docs/adr/004`) documents the change as intentional; `docker-compose.prod.yml` already passes `MASTRA_JWT_SECRET` (`:42`) so a secret-bearing operator is unaffected; `.env.example` + README lead with the one-line fix. Worker containers get the secret via spec 02's x-mastra-env passthrough (they share the composition root); the fail-fast gate itself stays unconditional.
  2. **Auth protects `/api/*` but NOT root `/health`.** Verified: default protected is `["/api/*"]` (`helpers-610L0lwQ.js:5`) and `/health` lives at root, so it stays public — good for the compose/k8s healthcheck (`docker-compose.prod.yml:51`, `scripts/health-check.sh`) but a surprise if someone assumes "auth = everything locked." **Mitigation:** call this out as a `AGENTS.md` gotcha + README note; assert `/health → 200` in tests so the behavior is pinned, not incidental; document that any *new* health-style root route is public by default and must be moved under the protected prefix or given `requiresAuth` explicitly.
  3. **Secret / worker-token rotation.** A shared `MASTRA_JWT_SECRET` and `MASTRA_WORKER_AUTH_TOKEN` are static; rotation today means redeploy + invalidate outstanding JWTs (no revocation list in the built-in JWT provider). **Mitigation:** follow `docs/auth/workers` "Security recommendations" — different tokens per worker type, scheduled rotation via env + container restart, TLS in production; document the rotation procedure in ADR-004. Note in the contract that long-lived JWTs need a short `exp` (the verify path checks expiry — the 401 body `"Invalid or expired token"` at `:230` confirms expiry is enforced).

* **Open Questions / Decisions:**
  * **OQ-1 — Default provider in the doc example:** built-in `@mastra/auth` `MastraJwtAuth` (matches `docs/auth/jwt`, needs the extra dep) vs. zero-dep `jose` `authenticateToken` behind the same `buildAuth` return type. **Owner:** spec author / platform lead. **Target:** before implementation kickoff (Phase-3 freeze).
  * **OQ-2 — Worker token mechanism:** reuse the JWT provider for `MASTRA_WORKER_AUTH_TOKEN`, or compose a `SimpleAuth` token-map via `CompositeAuth`? Changes whether Spec 02's worker sends a signed JWT or a raw secret. **Owner:** shared with Spec 02 author. **Target:** when Spec 02 starts.
  * **OQ-3 — Studio login target for the boilerplate demo:** JWT-only (Settings → Add Header → `Bearer`, `docs/auth/jwt`) vs. also wiring `SimpleAuth` users for an email/password login screen (`docs/auth/simple-auth`). **Owner:** platform lead. **Target:** Phase-3 review. (The remaining open piece is the `AUTH_PROVIDER` doc-example wording.)

## Phase 5: Non-Functional Requirements

* **Security:**
  * **100%** of built-in `/api/*` routes (and custom routes, which default to `requiresAuth: true` — `docs-server-custom-api-routes.md:236,276-282`) return `401` to anonymous callers on a production-configured instance. Measured by the route-walk acceptance test; target = every path in the `["/api/*"]` protected set.
  * **Zero** unauthenticated production boots: with `NODE_ENV=production`, absence of auth + `AUTH_DISABLED` yields a hard exit, verified by test (exit code 1). This is the "0 public production deployments" gate.
  * **Timing-safe comparison where applicable:** raw secret/token equality checks (e.g. a hand-rolled HS256 verify, or a `SimpleAuth` token lookup done ourselves) MUST use `crypto.timingSafeEqual`; `MastraJwtAuth` / `jose` already do constant-time signature verification internally, so this NFR applies only to any code path where the boilerplate itself compares a bearer string to a configured secret. When the recommended `@mastra/auth` path is taken (no hand-rolled compare), this line is **N/A-by-choice** — document which.
  * Authenticated principal mapped to a resource via `mapUserToResourceId` so memory/thread isolation is enforced (`reference-configuration.md:639`); without it Mastra logs a startup warning and ownership trusts the caller — the boilerplate sets it.
* **Performance:** auth middleware adds **< 5ms p95** overhead per protected request. Measured proxy (no live load harness in CI today): a unit benchmark wrapping `authenticateToken` for N=10k HS256 verifies asserts p95 < 5ms on the CI runner; and a hard gate that **zero-config dev boot time regression < 1s** (inert path returns `undefined` in O(1), adds no network call at boot). JWT verification is local crypto, no round-trip, so per-request cost is bounded by a single signature check.
* **Reliability / Availability:** fail-fast on boot beats fail-open at runtime — an unconfigured production instance never accepts traffic (avoids the "silently public HA stack" incident class). Worker endpoints keep `requiresAuth: true`; with auth configured the step-execution + event paths reject anonymous callers (`docs/auth/workers` warning). Root `/health` remains available **unauthenticated** so container/orchestrator probes never fail due to this feature (compatibility, not availability regression). **Availability target otherwise: N/A** (auth introduces no new upstream dependency).
* **Accessibility:** **N/A** — no new UI owned by the boilerplate; Studio's login screen ships with Mastra and is covered by `docs/studio/auth`.
* **Compatibility:** zero-config `npm run dev` behavior is **unchanged except for the added banner warning line** (Scenario 3): same boot, same routes public in dev, `tests/smoke/boots.test.ts` green untouched, and `cd docker && docker compose -f docker-compose.prod.yml config` still validates. When `@mastra/auth` is added, `npm ci` in CI must keep `npm_config_legacy_peer_deps=true` (root `AGENTS.md`); `package-lock.json` stays committed. No change to the single-process dev worker topology (`MASTRA_WORKERS=false`, `docker-compose.prod.yml:34`).

---

### Verified symbols (path:line)

| Symbol / fact | Location |
|---|---|
| `new Mastra({ server })` with no auth today | `src/mastra/index.ts:15` |
| server block sets only port + host `0.0.0.0` | `src/mastra/index.ts:27-30` |
| banner called after construction | `src/mastra/index.ts:33` |
| composition root `buildInfrastructure()` | `src/mastra/shared/config/infrastructure.ts:22` |
| `buildObservability(): Observability \| undefined` (pattern to mirror) | `src/mastra/shared/config/observability.ts:11` |
| `buildStorage(services): Storage` | `src/mastra/shared/config/storage.ts:14` |
| `detectModelProviders` / `detectScopeGuard` banner pushers | `src/mastra/shared/config/providers.ts:20,37` |
| `ServiceStatus` / `ServiceRegistry` / `logServiceAvailability` + format | `src/mastra/shared/config/service-status.ts:4,11,13-14` |
| `MASTRA_JWT_SECRET` dead var | `.env.example:63` |
| `MASTRA_STEP_EXECUTION_URL` (spec 02 wires; read contract here) | `.env.example:67` |
| prod `api` service + JWT passthrough + `/health` healthcheck + replicas:3 | `docker/docker-compose.prod.yml:29,42,51,57` |
| zero-config smoke imports live `mastra` instance | `tests/smoke/boots.test.ts:2` |
| `server.auth?: MastraAuthConfig \| IMastraAuthProvider` (real slot) | `node_modules/@mastra/core/dist/server/types.d.ts:361` (ServerConfig `:200`, `apiPrefix?: :241`) |
| `MastraAuthConfig` shape (protected/public/authenticateToken/mapUserToResourceId) | `node_modules/@mastra/core/dist/_types/@internal_auth/dist/types/index.d.ts:20,24,28,32` |
| `SimpleAuth` + `SimpleAuthOptions.tokens` exports | `node_modules/@mastra/core/dist/server/index.d.ts:13` / `.../@internal_auth/dist/provider/index.d.ts:123` |
| `CompositeAuth` export | `node_modules/@mastra/core/dist/server/index.d.ts:11` |
| default `protected:["/api/*"]`, `public:["/api","/api/auth/*"]` | `node_modules/@mastra/server/dist/helpers-610L0lwQ.js:5-6` |
| 401 `{"error":"Invalid or expired token"}` shape | `node_modules/@mastra/server/dist/helpers-610L0lwQ.js:229-230,289-290` |
| 403 `{"error":"Access denied"}` (authz/cross-resource) | `node_modules/@mastra/server/dist/helpers-610L0lwQ.js:297-298` |
| `/health` served at root (not under `/api/*`) | `node_modules/@mastra/server/dist/dist-4Qm6OSPJ.js` (health fetch) + `README.md:67` |
| `MastraJwtAuth` from `@mastra/auth` (`{ secret }`) | `docs/auth/jwt` / bundled `@mastra/core/dist/docs/references/docs-auth-jwt.md` |
| no-auth ⇒ all routes + Studio public | `docs/auth/overview` |
| worker endpoints `steps/execute` + `/api/workflows/events` are `requiresAuth:true`; `MASTRA_WORKER_AUTH_TOKEN` bearer | `docs/auth/workers` |
| Studio login supported by Simple Auth/JWT/WorkOS/Better Auth/Google | `docs/auth/overview` note |
| `mapUserToResourceId` omission ⇒ startup warning + trusts caller | `@mastra/core/dist/docs/references/reference-configuration.md:639` |
| ADR numbering next free = 004; append-only rule | `docs/adr/README.md`, `docs/adr/AGENTS.md` |
| Versions `@mastra/core` 1.66.0 / `mastra` 1.29.0 | `node_modules/@mastra/core/package.json`, `node_modules/mastra/package.json` |
