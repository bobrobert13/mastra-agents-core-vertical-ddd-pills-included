# Spec+: Distributed PubSub & Real Worker Topology (Phase 2)

> **Spec ID:** 02 · **Phase:** 2 · **Status:** DRAFT
> **Depends on:** Spec 01 (worker token auth contract). This spec only passes `MASTRA_WORKER_AUTH_TOKEN` / `MASTRA_STEP_EXECUTION_URL` through compose and documents the contract; the API-side provider that *accepts* the token belongs to Spec 01.
> **Blocks:** Spec 05 (scheduled workflows — `schedule:` fields are inert until a real scheduler worker exists).
> **Resolves:** `docs/PRODUCTION-GAP-ANALYSIS.md` §1.1 (fake HA stack), §1.2 (single-process event bus vs 3 API replicas), §1.3 for the vars this phase touches (`MASTRA_STEP_EXECUTION_URL` wired, `ENABLE_MULTI_REGION` deleted). Gap §5 deviation, noted deliberately: the `ENABLE_MULTI_REGION` deletion lands **here (Phase 2)** rather than in Phase 1 as the execution-order table suggests — it groups with the §1.3 dead-var work alongside the storage/compose edits it touches (Phase 1 stays focused on auth).
> **Grounded on:** `@mastra/core` 1.66.0 (`pubsub?: PubSub` at `node_modules/@mastra/core/dist/mastra/index.d.ts:224`, `get pubsub(): PubSub` at `:444`), `mastra` CLI 1.29.0 (`mastra worker build|start|dev` verified via `npx mastra worker --help`), `@mastra/redis-streams` 0.4.2 (npm, verified at authoring time), and the official docs [Workers](https://mastra.ai/docs/deployment/workers), [PubSub](https://mastra.ai/docs/server/pubsub), [RedisStreamsPubSub](https://mastra.ai/reference/pubsub/redis-streams).

## Phase 1: Strategic Vision

* **Vision:** A cloner who runs `docker compose -f docker-compose.prod.yml up -d` gets a genuinely distributed Mastra deployment — split workers consuming real workflow events, cross-domain events crossing process boundaries, and a startup banner that tells the truth about which mode is live — while the zero-config `npm run dev` promise stays untouched.

* **OKR / Goal (PROPOSED — pending D3 confirmation):** on the prod compose stack (Postgres + Redis + 3×api + orchestration + 1×scheduler + backgroundTasks):
  1. A `deep-research` workflow run started via `POST /api/workflows/deep-research/start` survives `docker compose kill api` on the replica that triggered it, and after the API restarts, the run reaches a terminal state (`success` or `failed` — never silently lost) in ≥ 9 of 10 scripted chaos trials.
  2. With one declared cron schedule and 1 scheduler replica, the schedule fires **exactly once per tick** across 20 consecutive ticks (0 duplicate `workflow.start` events).
  3. `npm run test:all` and `timeout 15 npm run dev` stay green with **zero** env vars set (the in-process default path is never regressed).

* **Non-goals:** worker/API *auth implementation* (Spec 01); durable-agent recovery config `recovery.durableAgents` (gap analysis §2.8 — separate phase); DLQ (does not exist in Mastra workers today — see Phase 4); RabbitMQ/Kafka; GoogleCloudPubSub implementation (doc pointer only); editing accepted ADR-001/002/003 files; **Redis as server cache (`RedisCache`) or Redis-backed rate limiting is OUT — this spec only establishes the `REDIS_URL` naming convention + the pubsub builder** (later specs that want Redis caching/rate limits re-point here for the convention, not the other way around).

## Phase 2: Functional Spec (BDD)

* **User Story:** As a **DevOps engineer deploying the HA reference stack**, I want the production compose to run real split Mastra workers over a distributed PubSub backend with correct roles, artifacts, and health checks, so that workflow execution actually survives API restarts and scales per role instead of silently no-oping.

### Acceptance Criteria

* **Scenario 1: Distributed boot (happy path)**
  * **Given** `docker/docker-compose.prod.yml` with `.env` supplying `DB_PASSWORD` and `REDIS_URL` defaulting to `redis://redis:6379` inside the stack
  * **When** `docker compose -f docker-compose.prod.yml up -d --build` finishes and each container's `/health` returns `200`
  * **Then** every process's startup banner contains the line `✅ PubSub           Redis Streams (REDIS_URL) — distributed`, the `background-tasks` container reports `MASTRA_WORKERS=backgroundTasks` (not `background`), and every worker container's `/health` returns 200 **and its startup log names the selected worker role** — `docker compose ps` alone cannot distinguish the worker artifact from the API bundle, so it is not the assertion.

* **Scenario 2: Zero-config dev boot unchanged (regression guard)**
  * **Given** a fresh clone with **no** `.env` and no Redis reachable
  * **When** `npm run dev` runs
  * **Then** the app boots on port 4111 with the banner line `○ PubSub           in-process (EventEmitterPubSub) — split workers unavailable`, workflows/agents run fully in-process, and `npm run test:smoke` (which asserts `mastra.pubsub` is the in-process default) exits 0.

* **Scenario 3: Invalid worker value rejected**
  * **Given** the corrected compose where no service sets `MASTRA_WORKERS=background`
  * **When** an operator copies an old recipe and starts the worker artifact with `MASTRA_WORKERS=background`
  * **Then** no background-task worker runs. Two distinct paths (both verified in `@mastra/core` 1.66.0 dist): the **env path** does not hard-fail — `MASTRA_WORKERS=background` matches no registered worker and the process logs a single WARN (`"MASTRA_WORKERS=background did not match any registered workers"`, dist `:4521`) while serving nothing; the **explicit CLI-name path** (`mastra worker start background`) **throws** (dist `:4517`). A mis-named container therefore *looks healthy* on the env path — which is exactly why the boilerplate must never ship the invalid value; the repo-level assertion: `grep -R "MASTRA_WORKERS=background\b" docker/` returns nothing (guard placement = open question Q4).

* **Scenario 4: API crash mid-workflow — visible, resumable-or-failed state (edge case)**
  * **Given** the Scenario 1 stack and a `deep-research` run in progress, its next step dispatched to the orchestration worker (`MASTRA_STEP_EXECUTION_URL=http://api:4111/api`)
  * **When** the API replica that started the run is killed and restarted (`docker compose kill api && docker compose up -d api`)
  * **Then** — grounded strictly in what the docs promise: unacked PubSub events are redelivered to the restarted orchestration worker(s) (at-least-once, so step handlers may run twice — idempotency documented), and once the API is back the step-execution call succeeds and the run completes; if the crash happened *during* step execution, the run remains `running` and is retrievable via the workflows API (no silent loss, **no automatic retry, no DLQ** — this is a documented Mastra limitation, not a boilerplate bug). The scenario's testable assertion: the run reaches `success`/`failed`, **or** is observably `running` with state in storage — never 404/vanished.

* **Scenario 5: Cross-process domain event with scoped guarantee (the ADR-003 pattern made real)**
  * **Given** the Scenario 1 stack (Redis configured) and a subscriber for `research.completed` registered in api replica B's process
  * **When** code in api replica A calls `eventBus.publish({ type: 'research.completed', payload: {...} })`
  * **Then** replica B's handler is invoked within 2 s via the bridge (at-least-once; payload arrives JSON round-tripped, so `Date` fields arrive as ISO strings — declared limitation), replica A's own in-process listeners still fire synchronously exactly as today (no behavior change), and **without** `REDIS_URL` the bus is guaranteed single-process only — which is what the new ADR-005 and `shared/AGENTS.md` state explicitly.

## Phase 3: Technical Contract & DoD

### 3.1 Dependency & scripts surface

`package.json` (current scripts at `:6-26`; `mastra build` writes `.mastra/output/` — root AGENTS.md gotcha #6):

```jsonc
// dependencies +
"@mastra/redis-streams": "^0.4.2",
// scripts +  (no existing script changes)
"build:worker": "mastra worker build --output-dir .mastra/worker",
"build:all": "npm run build && npm run build:worker"
```

Install rule unchanged: `npm install --legacy-peer-deps` (gotcha #1). CI `build` job (`.github/workflows/ci.yml:35-36`) runs `npm run build:all` and asserts `.mastra/worker/index.mjs` exists.

### 3.2 New builder: `src/mastra/shared/config/pubsub.ts`

Follows the env-optional convention (`shared/AGENTS.md`: builder in `config/<service>.ts`, `ServiceStatus` pushed in **both** branches, wired via `infrastructure.ts`):

```typescript
import type { PubSub } from '@mastra/core/events'; // re-export verified in core dist events/index.d.ts
import type { ServiceRegistry } from './service-status';

/**
 * PubSub selection (fully optional):
 *   REDIS_URL → RedisStreamsPubSub (distributed: split workers + event-bus bridge)
 *   nothing   → undefined → Mastra's default EventEmitterPubSub (in-process)
 */
export function buildPubsub(services: ServiceRegistry): PubSub | undefined {
  const url = process.env.REDIS_URL;
  if (!url) {
    services.push({ name: 'PubSub', active: false,
      detail: 'in-process (EventEmitterPubSub) — split workers unavailable' });
    return undefined;
  }
  services.push({ name: 'PubSub', active: true,
    detail: 'Redis Streams (REDIS_URL) — distributed' });
  // Static import of RedisStreamsPubSub at module top is intended (the package ships with the app bundle).
  // Constructor options left at defaults: keyPrefix 'mastra:topic', maxDeliveryAttempts 5,
  // reclaimIntervalMs 30000, reclaimIdleMs 60000.
  return new RedisStreamsPubSub({ url });
}
```

Requires **`redis:7-alpine`** in compose: the official [RedisStreamsPubSub reference](https://mastra.ai/reference/pubsub/redis-streams) states Redis 7.0+ is required (its reclaim loop relies on stream-claim semantics); the bundled 0.4.2 package implements the loop with `xAutoClaim`. Either way Redis 7 satisfies the floor — do not pin an older image.

### 3.3 Composition root changes

`src/mastra/shared/config/infrastructure.ts:22-30` — call the builder + attach the bridge; return `pubsub`. `src/mastra/index.ts:15-31` — spread like observability (`index.ts:26` is the precedent):

```typescript
// infrastructure.ts
const pubsub = buildPubsub(services);
attachEventBusBridge(pubsub);            // no-op when pubsub === undefined
return { storage, observability, pubsub, services };

// index.ts
export const mastra = new Mastra({
  /* agents, workflows, storage, ...observability */
  ...(pubsub && { pubsub }),
});
```

`Infrastructure` interface gains `pubsub?: PubSub` — one field, additive only.

### 3.4 `docker/Dockerfile` — role-parameterized multi-stage

Current file (`:20` builds only `npm run build`; `:36` copies `/app/dist`, which contradicts gotcha #6 — the API bundle lands in `.mastra/output/`; `:51` CMD `npm run start`). Replace the builder/runner with the official `ARG MASTRA_OUTPUT` pattern:

```dockerfile
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG MASTRA_OUTPUT=.mastra/output
RUN if [ "$MASTRA_OUTPUT" = ".mastra/worker" ]; \
    then npm run build:worker; else npm run build; fi

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=4111 HOST=0.0.0.0
ARG MASTRA_OUTPUT=.mastra/output
COPY --from=builder --chown=app:app /app/${MASTRA_OUTPUT}/package.json /app/${MASTRA_OUTPUT}/.npmrc* ./
RUN npm install --omit=dev
COPY --from=builder --chown=app:app /app/${MASTRA_OUTPUT}/ .
USER app
EXPOSE 4111
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4111/health',(r)=>{process.exit(r.statusCode===200?0:1)})"
CMD ["node", "index.mjs"]
```

Both roles run the *same* entrypoint; `MASTRA_WORKERS` in the environment selects the role (per the docs compose example — no `mastra worker start` CLI command needed in containers). `/health` is served by the worker artifact too (503 while `startWorkers()` initializes, 200 when ready — ref workers doc "Health checks"), so the existing `:47-48` healthcheck shape is reused as-is. `npm run start` (`mastra start`) remains the local runner; the image no longer depends on the `mastra` CLI at runtime.

### 3.5 `docker/docker-compose.prod.yml` — diff

```yaml
# NEW shared anchors (top of file)
x-mastra-env: &mastra-env
  DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
  REDIS_URL: redis://redis:6379
  LOG_LEVEL: ${LOG_LEVEL:-info}
  MASTRA_JWT_SECRET: ${MASTRA_JWT_SECRET:-}   # cross-spec (01): 01's production fail-fast kills EVERY
                                               # process sharing the composition root — workers included;
                                               # they serve no client routes, so auth config there is
                                               # harmless. 01's risk table assumed this passthrough.
x-worker: &worker
  build: { context: .., dockerfile: docker/Dockerfile,
           args: { MASTRA_OUTPUT: .mastra/worker } }

  redis:                                  # NEW service
    image: redis:7-alpine                 # ≥7.0 required; Valkey = open question Q1
    command: ["redis-server", "--appendonly", "yes"]   # unacked events must survive redis restart (crash recovery)
    volumes: [redis_data:/data]
    healthcheck: { test: ["CMD","redis-cli","ping"], interval: 5s, timeout: 3s, retries: 5 }
    networks: [mastra-network]            # like all siblings
    # deliberately NO ports: 6379 is never host-exposed

  postgres:                               # unchanged except:
    # ...
  api:                                    # changed lines only
    environment: [ ... + REDIS_URL (via <<: *mastra-env where practical),
                   + MASTRA_WORKER_AUTH_TOKEN=${MASTRA_WORKER_AUTH_TOKEN:-} ]   # passthrough; consumed by Spec 01 auth
    depends_on: postgres healthy + redis: { condition: service_healthy }
    healthcheck:                          # REPLACE the curl block (:50-55) — found by the spec gate, NOT in the gap
      test: ["CMD","node","-e","require('http').get('http://localhost:4111/health',(r)=>{process.exit(r.statusCode===200?0:1)})"]
                                          # analysis: the node:22-alpine runner has no curl, so this healthcheck
                                          # never passes → every worker `depends_on: api service_healthy` hangs.
                                          # Use the image HEALTHCHECK's node -e shape (Dockerfile:47-48) or drop
                                          # the compose-level block and inherit it.
    # replicas: 3 stays (:57) — now actually meaningful for signals/resumable streams

  orchestration:                          # :68-92
    <<: *worker                           # replaces the api-bundle build (:69-71)
    command: []                           # DELETE "mastra worker start orchestration" (:72) — role comes from env
    environment: [ MASTRA_WORKERS=orchestration,
                   + MASTRA_STEP_EXECUTION_URL=http://api:4111/api,   # was dead in .env.example:67
                   + MASTRA_WORKER_AUTH_TOKEN=${MASTRA_WORKER_AUTH_TOKEN:-},
                   + <<mastra-env incl. REDIS_URL> ]
    depends_on: api service_healthy (converges only with the fixed api healthcheck above), redis service_healthy
    replicas: 2 stays                     # PubSub consumer groups distribute work (docs "Scale workers")

  scheduler:                              # :94-112
    <<: *worker ; command deleted ; + REDIS_URL via mastra-env
    replicas: 1                           # KEEP (:106) — docs: multiple schedulers = duplicate fires
    # note in file: only ONE scheduler, ever (root AGENTS.md gotcha, Phase 3 docs)

  background: → rename service  background-tasks    # :114-138
    <<: *worker ; command deleted (:118)
    MASTRA_WORKERS=backgroundTasks        # FIXES invalid "background" (:120)
    + REDIS_URL via mastra-env ; replicas: 2 stays

volumes: + redis_data
```

Also pass `DEEPINFRA_API_KEY`/`OPENAI_API_KEY`/… through to workers as today (they execute agent-backed steps). `docker-compose -f docker-compose.prod.yml config` must validate (docker/AGENTS.md testing rule).

### 3.6 Event-bus bridge — `src/mastra/shared/events/event-bus-bridge.ts` (new) + ~20-line change to `event-bus.ts`

Call-site API (`publish` at `event-bus.ts:25`, `subscribe` at `:37`, singleton `:69`) is **unchanged** — ADR-003 usage keeps compiling untouched. Bridge adds one outbound seam:

```typescript
// event-bus.ts additions (private, not public API)
private _outbound?: (e: { type: string; payload: unknown }) => void;
_setOutbound(fn: ((e: { type: string; payload: unknown }) => void) | undefined): void;
_inbound(event: { type: string; payload: unknown }): void; // emit() only, never re-publishes
```

```typescript
// event-bus-bridge.ts
// REAL core contract (verified in dist): PubSub.publish(topic, event: Omit<Event,'id'|'createdAt'>, opts?)
// and EventCallback receives a full Event — so the domain {type,payload} rides inside Event.data
// (dist/events/types.d.ts: Event = { type; id; data; runId; createdAt; index?; deliveryAttempt? }).
import type { PubSub } from '@mastra/core/events';
export const DOMAIN_EVENTS_TOPIC = 'domain.events';     // stream key: mastra:topic:domain.events
const DOMAIN_EVENT_TYPE = 'domain.event';               // Event.type carrier for all bridged traffic
interface BridgedData { origin: string; domainType: string; payload: unknown }
const INSTANCE_ID = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function attachEventBusBridge(pubsub?: PubSub): void {
  if (!pubsub) return;                                   // zero-config: bus stays plain EventEmitter
  const outbound = (e: { type: string; payload: unknown }) =>
    void pubsub.publish(DOMAIN_EVENTS_TOPIC, {
      type: DOMAIN_EVENT_TYPE,
      runId: INSTANCE_ID,                                // required string field; doubles as origin
      data: { origin: INSTANCE_ID, domainType: e.type, payload: e.payload } satisfies BridgedData,
    });
  eventBus._setOutbound(outbound);
  // NO group → private consumer group → every process receives every event (fan-out, ref redis-streams subscribe doc)
  void pubsub.subscribe(DOMAIN_EVENTS_TOPIC, (event, ack) => {
    try {
      const data = event.data as BridgedData | undefined;
      if (!data || typeof data.domainType !== 'string') return;         // malformed → dropped (see 3.10 validation)
      if (data.origin === INSTANCE_ID) return;                          // echo guard: local listener already fired
      eventBus._inbound({ type: data.domainType, payload: data.payload });
    } finally {
      // EVERY delivery must be ack'd — including guard/drop paths — or the Redis PEL grows and the
      // reclaim loop redelivers up to maxDeliveryAttempts, multiplying duplicate fan-out
      // (core EventCallback contract, dist/events/types.d.ts:96-101). The bridge has no nack path.
      void ack?.();
    }
  });
}
```

**Deliberate scope decision (documented degradation path, not silent overpromise):**
* `REDIS_URL` unset → bus = single-process EventEmitter exactly as today; ADR-005 + `shared/AGENTS.md` state the guarantee boundary.
* `REDIS_URL` set → in-process delivery unchanged (sync emit) **plus** at-least-once fan-out to other processes. Bus-level semantics remain best-effort: the bridge acks **every** delivered event on receipt — including echo-guarded and malformed ones, so no pending-entry-list backlog is created — and the `EventCallback`'s `ack`/`nack` are not surfaced per handler — the `publish()` API returns before remote handlers run, so a throwing remote listener does **not** trigger redelivery. JSON round-trip turns `Date` payload fields into ISO strings, and after `maxDeliveryAttempts` (default 5) an event is dropped — **no DLQ exists** (workers doc, "Known limitations"). Full queue-grade parity (per-handler retries, ordering, exactly-once) is explicitly out of scope; consumers needing it use workflow steps, not the bus.
* No production publishers exist yet — verified: `codegraph callers eventBus` resolves to `tests/integration/cross-domain.test.ts:1`, `tests/unit/shared/event-bus.test.ts:1`, and the barrel only; domain tools do not publish (e.g. `create-task.ts` returns a fabricated object without touching the bus, despite the usage ADR-003 documents; gap §1.4 covers the same no-op tools from the persistence side). The bridge is exercised by tests now and by real publishers in Spec 05.

### 3.7 Delete `ENABLE_MULTI_REGION` (gap §1.3 decision: legitimate deletion)

Removed, not rewired — multi-region replication is a DB-infra decision, not a Mastra config knob:
* `src/mastra/shared/config/storage.ts` — the `isMultiRegion` read (`:17`), the non-postgres "reported as ignored" push (`:24-30`), the entire `buildPostgres` replication branch (`:49-76`, incl. the `replication:` object `:70-74`), **and the now-stale header comment at `:10`** (`"DATABASE_URL (postgres) → PostgreSQL (multi-region only here)"`); `buildStorage` collapses to `DATABASE_URL → postgres://… ? new PostgresStore({id,connectionString}) : LibSQL chain`.
* `.env.example` — the four-var block (`:43-47`); **adds** a `REDIS_URL=` line under a new `# === PubSub / Workers (HA) ===` header next to the existing `MASTRA_STEP_EXECUTION_URL` (`:67`, now real) and a commented `MASTRA_WORKER_AUTH_TOKEN=` pointing at Spec 01. Do **not** re-pin the existing `MASTRA_WORKERS=false` line (`:66`) — Spec 05 will rebase its own additions on this post-merge block layout.
* Root `AGENTS.md` service table row `Multi-region` (`:61`); `README.md` (`:11`, table row `:109`, paragraph `:156`); `src/mastra/shared/AGENTS.md` storage row (`:15`). Historical records (`PHASE-1-COMPLETION.md:162-164`, `PROJECT-COMPLETION.md`) are **not** rewritten. ADR-002 mentions are left as-is (accepted, append-only).

### 3.8 Docs & ADR (repo rule: new ADRs supersede; never edit accepted ones)

* **New `docs/adr/005-cross-process-eventing.md`** — Status: Accepted; **Supersedes ADR-003** (ADR-003 file itself untouched; supersession tracked in `docs/adr/README.md` index + a new bullet there). Numbering is fixed by the merge-coordination pass: Spec 01 keeps ADR-004, so this spec lands as **ADR-005**. Content: env-optional Redis bridge contract, at-least-once + echo-guard + ack-every-delivery + JSON-serialization semantics, the no-DLQ / no-per-handler-retry limits, and the single-process guarantee when Redis is absent.
* **New/updated gotchas & tables:** root `AGENTS.md` — service table gains `| PubSub (workers HA) | REDIS_URL | in-process EventEmitterPubSub; split workers unavailable |`; the new gotcha takes the **next free gotcha # at merge time** (numbering follows phase order — this spec lands **#10** if Spec 01 merged first): *"Prod HA needs REDIS_URL: workers do not start against the in-process default (docs) — and exactly ONE scheduler replica (duplicate fires otherwise)"*; troubleshooting "Worker duplication" line rewritten from `MASTRA_WORKERS` hand-wave to the concrete rule. `docker/AGENTS.md` — documents the `MASTRA_OUTPUT` build arg, worker artifact, redis service, and that the app image still boots with **no env** (LibSQL + in-process). `src/mastra/shared/AGENTS.md` — rows for `config/pubsub.ts` + `events/event-bus-bridge.ts` and the bus guarantee boundary.

### 3.9 Estimated Impact (estimate — grounded in the files read + `codegraph impact buildStorage` = 4 symbols / 3 files, `codegraph callers eventBus` = 3 files)

~**615 LOC across ~18 files**: compose +≈80 (146→~226 lines, incl. healthcheck fix + anchors) · Dockerfile rewrite ≈40 · `pubsub.ts` new ≈45 · `event-bus-bridge.ts` new ≈65 · `event-bus.ts` ±20 · `infrastructure.ts` +6 · `index.ts` +2 · `storage.ts` −32 · `package.json` +3 · `.env.example` net +2 · `ci.yml` +12 · tests ≈220 + chaos script ≈40 (3.10) · ADR-005 ≈90 + doc tables/README/TESTING ≈45.

### 3.10 Definition of Done

- [ ] Acceptance criteria covered by tests:
  - **Smoke** (`tests/smoke/boots.test.ts`, currently asserts storage at `:29-31`): new case asserts zero-config default — `mastra.pubsub` exists and `constructor.name === 'EventEmitterPubSub'`; still runs with **no env** (CI job intentionally env-less, `ci.yml:48-50`).
  - **Unit**: `tests/unit/shared/pubsub-config.test.ts` — `buildPubsub` pushes the right `ServiceStatus` in both branches; returns `undefined` without `REDIS_URL`; returns `RedisStreamsPubSub` (instanceof; no connection asserted) with it. `tests/unit/shared/event-bus-bridge.test.ts` — with a fake `PubSub`: `publish` forwards a core-contract `Event` carrying `{origin, domainType, payload}` in `data`; inbound re-emits locally from `event.data`; echo-guarded (own `origin` skipped); no-Redis attach is a no-op; **existing `event-bus.test.ts` must pass unmodified** (API compatibility proof).
  - **Integration**: `tests/integration/event-bus-redis.test.ts` gated `describe.skipIf(!process.env.REDIS_URL)` (pattern per tests/AGENTS.md) — real round-trip publish→remote-inbound incl. JSON/Date caveat; skips cleanly in CI without the service. CI `test-integration` job (`ci.yml:64-89`) gains a `redis:7-alpine` service + `REDIS_URL` env so the gated tier actually runs.
  - **Compose guard**: test or script asserting no `MASTRA_WORKERS=background` (invalid) and that `backgroundTasks`/`orchestration`/`scheduler` appear in the prod file; `docker compose config` validation stays manual per docker/AGENTS.md.
- [ ] Input/Output payload validation: inbound `Event.data` shape validated (`data.domainType` must be a string; malformed → logged via `logger` + dropped, never thrown into the bus); `buildPubsub` treats any non-empty `REDIS_URL` as opt-in and lets constructor errors surface as a **loud startup failure with the URL name** (fail-fast only for *present-and-invalid*, matching gap §3.4 spirit without a full Zod layer).
- [ ] `npm run build:worker` produces `.mastra/worker/index.mjs` locally and in CI.
- [ ] `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`), `npm run test:all` green with zero env **and** with `REDIS_URL` pointed at a throwaway local Redis.
- [ ] `timeout 15 npm run dev` boot verified (banner now includes the PubSub line).
- [ ] ADR-005 written + `docs/adr/README.md` index updated; root/`docker`/`shared` AGENTS.md tables and gotchas in sync (banner lines copied verbatim into docs).
- [ ] `ENABLE_MULTI_REGION`/`PRIMARY_REGION`/`SECONDARY_REGION`/`REPLICATION_LAG_MS` have zero references outside historical completion records (`grep -R` clean).
- [ ] Chaos trial for OKR #1: script `tests/chaos/api-kill.sh` (start `deep-research` run → `docker compose kill api` → restart → poll run state) executes the 10 trials and asserts terminal-or-observably-`running` state. **Manual verification against the prod compose** (needs Docker + Redis; not a CI tier), consistent with the guardrail that browser/compose verification is left to the user.
- [ ] Doc-sync beyond AGENTS.md tables: `README.md` gains the PubSub service-table row and its HA paragraph (around `:156`) rewritten for the real stack (redis + worker artifact, no "multi-region toggle"); root `AGENTS.md` Deployment section service count updated ("5 services" → new prod-compose service list incl. redis); `docs/TESTING.md` CI table updated for `build:all` and the redis service container in `test-integration`.
- [ ] Work on a branch named `feat/distributed-pubsub-workers`
- [ ] Commits staged every 400–800 LOC; never exceed 1400 LOC per commit (natural splits: ① pubsub builder + config + unit/smoke, ② Dockerfile + compose + docs-docker, ③ bridge + integration, ④ multi-region deletion + AGENTS/README + ADR-005)
- [ ] Business and UI tests written where applicable; manual/browser verification (actual `docker compose up`, chaos kill) left to the user

## Phase 4: Risks & Open Questions

* **Risks (3):**
  1. **Redis becomes a hard dependency for HA deployments.** Every prod-stack process (and future signals/scheduler wake-ups) breaks when Redis is down or misconfigured. *Mitigation:* it is opt-in per repo signature — dev/zero-config never touches it (`buildPubsub → undefined`); compose runs Redis with AOF + healthcheck + `depends_on: service_healthy`; the banner names the mode at boot so a forgotten `REDIS_URL` is visible, not silent.
  2. **Runs stuck in `running` after an API crash — no DLQ, no auto-retry.** Docs "Known limitations": work lost mid-step-execution leaves the run `running`; events dropped after `maxDeliveryAttempts` (5). *Mitigation:* this spec's honest promise (Scenario 4) is "visible state, never silent loss"; root AGENTS.md + ADR-005 document it; `restart: unless-stopped` on all prod services; `recovery.durableAgents: 'auto'` is recorded as the follow-up knob (gap §2.8, next phase) — **not** silently implemented here.
  3. **Duplicate schedule fires if the scheduler is scaled.** Anyone copying `replicas: 2` from the other worker blocks double-publishes every cron tick (docs: scheduler is single-instance by design). *Mitigation:* `replicas: 1` is kept with an inline comment (already `docker-compose.prod.yml:106`), the new gotcha (§3.8 merge-time numbering) states the rule, and OKR #2 makes it testable; compose `deploy` blocks make the deviation visible in review.

* **Open Questions / Decisions (D4 candidates for the maintainer; none blocks starting §3.1–3.5):**
  | # | Decision | Owner | Target |
  |---|---|---|---|
  | Q1 | Image choice: `redis:7-alpine` (docs example) vs `valkey/valkey` (license-history concern; needs `ValkeyStreamsPubSub`, same builder seam) | infra lead | before merge of commit ② |
  | Q2 | `GoogleCloudPubSub`: ship a `PUBSUB_BACKEND` switch in `buildPubsub` or keep doc-pointer only? **PROPOSAL: doc-pointer only** (repo anti-filler rule, gap §4) | repo maintainer | before merge of commit ① |
  | Q3 | Should CI run the Redis-gated integration tier (adds service container, ~5 LOC) or keep it opt-in local-only? **PROPOSAL: run it** — this spec's core promise is otherwise untested | repo maintainer | commit ③ |
  | Q4 | Compose guard placement: unit test parsing YAML vs grep rule in `health-check.sh` (Scenario 3's mechanism) | implementer | commit ① |

## Phase 5: Non-Functional Requirements

* **Performance:** orchestration→API step-execution hop (`MASTRA_STEP_EXECUTION_URL`, container bridge network) adds **< 50 ms p95** per step dispatch (measured via observability spans around the HTTP call); event-bus bridge publish adds **< 10 ms p95** over local Redis and is fire-and-forget off the publish path (zero-config publish latency unchanged vs today's sync `emit`, asserted by keeping existing `event-bus.test.ts` timing-free). Both targets are **measured during the manual chaos verification (`tests/chaos/api-kill.sh` run + spans), not CI-gated** — CI tiers stay deterministic/offline per the test-pyramid rules.
* **Security:** token issuance/validation contract = Spec 01 (not this spec). This spec's enforceable surface: Redis is **never host-published** in prod compose (no `ports:` on the service — verifiable in YAML); worker containers expose no inbound routes to clients (docs network architecture: outbound-only); step-execution stays on the internal `api:4111` service URL. Production Redis AUTH (`requirepass`) is a documented follow-up, tracked as Q1-adjacent note in ADR-005.
* **Reliability / Availability:** scheduler `replicas: 1` enforced in-file + the new gotcha (§3.8 merge-time numbering; exactly-one-per-tick measured in OKR #2); unacked events redelivered after crash (Redis Streams persistence; reclaim defaults 30 s interval / 60 s idle / 5 attempts — defaults kept, values quoted in ADR-005); Redis runs with AOF (`appendonly yes`) so redelivery survives Redis restart; at-least-once → step handlers must be idempotent (documented in ADR-005 + docker/AGENTS.md).
* **Accessibility / Compatibility:** a11y **N/A** (no UI surface). Compatibility: zero-config contract intact — `npm run test:smoke` env-less green (Scenario 2), `mastra` v1.66.x peer line unchanged (`package.json` dep `@mastra/core ^1.66.0`), Node ≥ 22.13 (`engines`), existing `eventBus.publish/subscribe/subscribeOnce/clearListeners` signatures byte-identical, and every existing AGENTS.md gotcha preserved — this spec adds exactly one new gotcha, taking the next free # at merge time (§3.8 numbering rule; #10 if Spec 01 lands first).
