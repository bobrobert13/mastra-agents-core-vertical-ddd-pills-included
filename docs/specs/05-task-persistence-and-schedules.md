# Spec+: Real Task Persistence & Declarative Schedules (Phase 5)

| Field | Value |
|---|---|
| **Spec id** | 05 |
| **Phase** | 5 (per `docs/PRODUCTION-GAP-ANALYSIS.md` §5 execution order: "Real task-management persistence + declarative `schedule` on one workflow") |
| **Depends-on** | Spec 02 (scheduler worker + evented-runs topology: `MASTRA_WORKERS` values, distributed pubsub, worker build) |
| **Addresses** | Gap analysis §1.4 (tools persist nothing), §2.5 (zero real schedules), §2.1 context (auth on `/api/schedules`) |
| **Status** | DRAFT |
| **Ground truth** | Verified against `@mastra/core@1.66.0`, `@mastra/libsql@1.22.5`, `@mastra/pg@1.24.0` (installed `node_modules`) and mastra.ai docs, 2026-09. Every symbol citation in this spec was checked at the listed path:line. |

---

## Phase 1: Strategic Vision

* **Vision:** The canonical example stops lying: `create_task` writes a durable row that survives restarts and reappears on the next turn, `schedule_task` creates a real persisted cron schedule, and a declaratively-scheduled `daily-digest` workflow makes the scheduler worker (spec 02) observable end-to-end in Studio — no more decorative entity, no more `Math.random()` "ids".
* **OKR / Goal (PROPOSED):**
  * **KR1:** 100% of `create_task`/`update_task`/`schedule_task` mutations are backed by committed rows; a task created before `kill -9` is retrievable by `getTask` after reboot (asserted by an integration test, plus a unit test on `:memory:`).
  * **KR2:** `daily-digest` appears as a schedule row (`wf_daily-digest`) after boot, is listed at Studio `/workflows/schedules` and via `GET /api/schedules`, and pause/resume — via the **Studio schedule detail page** or raw `POST /api/schedules/wf_daily-digest/pause` / `/resume` — demonstrably stops/starts fires. (`@mastra/client-js` is NOT a dependency of this repo, so `client.pauseSchedule()` is only the doc-level shorthand; it becomes the ergonomic path if a later spec adds the client package.)
  * **KR3:** `mastra.schedules` CRUD is exercised by the tools tier without opening any second database; `npm run test:smoke` (zero-config, no env) and every existing unit test stay green — unit tiers never require a running server or API key.
  * **KR4:** Zero remaining doc/test assertions claiming the old fake behavior (see DoD "fake-assert inventory").

---

## Phase 2: Functional Spec (BDD)

* **User Story:** As a **team lead using the `tasks` agent in a shared, always-on boilerplate instance**, I want the tasks I ask the agent to track to survive restarts and be visible/editable by my team, and I want recurring work (a daily digest, per-task reminders) to actually fire on a cron — operable (pause/resume) from Studio without a redeploy — so that the agent behaves like a dependable shared tool rather than a stateless demo.

### Acceptance Criteria

* **Scenario 1: Create → persist → update (happy path)**
  * **Given** a running instance with default storage (LibSQL file or `DATABASE_URL` Postgres)
  * **When** the user asks "create a task: review PR #42, high priority" and then, in a later turn, "mark PR #42 in progress"
  * **Then** `create_task` inserts a row in the `tasks` table and returns the stored `taskId` (a UUID), and `update_task` mutates that same row (`status = 'in-progress'`, bumped `updated_at`, `version` incremented), each emitting `task.created` / `task.updated` on the event bus; the read-back is asserted **via the repository** in tests (`getTask`/`listTasks` return the persisted values) — this phase deliberately adds no get/list *tool* (kept out of scope).

* **Scenario 2: Agent restart, same database → task still there**
  * **Given** tasks created in a first process against `file:./mastra.db` (or a Postgres `DATABASE_URL`)
  * **When** the process is killed and a fresh process boots with the same env
  * **Then** `getTask(id)` returns the pre-restart row, and `listTasks()` includes it (durability proven by reopening the storage, not by an in-memory cache).

* **Scenario 3: Zero-config, provider-less boot still persists**
  * **Given** an environment with **no** `*_API_KEY` and no `DATABASE_URL` (pure clone-and-run)
  * **When** `create_task` / `update_task` run
  * **Then** the row is still written and read back — persistence depends only on storage, never on LLM availability (the tools are deterministic code paths; the model merely decides to call them). An eval-tier test may skip without a key; the persistence contract may not.

* **Scenario 4: `schedule_task` creates a real, durable schedule (integration-gated)**
  * **Given** an instance where the scheduler is active (dev single-process, or spec-02 topology with one `MASTRA_WORKERS=scheduler` worker)
  * **When** the user says "remind me about task <id> every day at 9am" and `schedule_task` runs with a cron
  * **Then** a `Schedule` row is written to the **storage schedules domain** with id `agent_task-<slug(taskId)>` — this is an **agent** schedule, and `CreateAgentScheduleInput.id` normalizes to the `agent_` prefix (`@mastra/core/dist/schedules/schedules.d.ts:62-67`; the `schedule_` prefix at :91-97 applies to imperative **workflow** schedules only) — visible via `GET /api/schedules` with `nextFireAt` computed; `mastra.schedules.run(id)` returns its claim record `{ scheduleId, claimId, scheduledFireAt }` (`schedules.d.ts:179-183`) and the gated integration test asserts **that return + `list()` state, not an actual agent fire** — for agent schedules `run()` only publishes to the `agent-schedules` pubsub topic and records **no trigger row** (trigger history is the workflow-schedule surface), and an observable fire additionally requires the `AgentScheduleWorker` plus a provider key; the task row records its `schedule_id`; a re-run for the same task **updates** the existing schedule (the API's "duplicate id throws" rule is handled by the tool, making the tool idempotent).

* **Scenario 5: Concurrent update conflict (edge)**
  * **Given** the same `taskId` updated twice against a stale read (two tool calls / two sessions carrying `version = 3` while the row is already at 4)
  * **When** the second `update_task` executes
  * **Then** the guarded write (`WHERE id = ? AND version = ?`) affects 0 rows, the tool returns `updated: false` with a `CONFLICT` reason and the current row — never a silent fake `updated: true`; the row is never corrupted (last-writer-wins is explicit, not accidental).

---

## Phase 3: Technical Contract & DoD

### 3.0 Ground truth verified (what exists, what doesn't)

| Claim | Verdict | Evidence |
|---|---|---|
| `createWorkflow({ schedule })` exists, promoted to evented engine | ✅ | `@mastra/core/dist/workflows/types.d.ts:949,983` (`schedule?: WorkflowScheduleInput`; note: NOT `workflow.d.ts`, which is 840 lines with zero `schedule` matches — corrected per review); `dist/workflows/scheduler/types.d.ts:6` — "Only supported on the evented engine."; `dist/agent-CEHR0Wd8.js:8673-8678` — `createWorkflow`: "auto-promoting to the evented engine when a `schedule` is declared" |
| Scheduled fires + manual runs share one code path; `start()` unchanged | ✅ | docs/workflows/scheduled-workflows ("The public API … is unchanged, `EventedWorkflow extends Workflow`") |
| **LibSQL satisfies the evented concurrency requirement** | ✅ | see §3.6 (resolved) |
| Declarative schedule row id = `wf_<workflowId>` (single) / `wf_<workflowId>__<scheduleId>` (array) | ✅ | `@mastra/core/dist/mastra-B-GDpHtP.js:361-362` + docs pause/resume example (`client.pauseSchedule('wf_daily-report')`) |
| `mastra.schedules` unified service: `create/get/list/update/delete/pause/resume/run` for **agent AND workflow** schedules | ✅ | `@mastra/core/dist/schedules/schedules.d.ts:168-180`; docs/harness/schedules; `@mastra/core/dist/mastra/index.d.ts:534` (`get schedules(): Schedules`, lazily built over `getStorage()?.getStore('schedules')`, :519 comment) |
| Imperative workflow-schedule ids normalize to `schedule_<slug>`; `wf_` is reserved for declarative rows (boot sync sweeps `wf_` only) | ✅ | `dist/schedules/types.d.ts:47` (`WORKFLOW_SCHEDULE_PREFIX = "schedule_"`), `dist/schedules/schedules.d.ts:94-101`; creating with an existing id **throws** (reference/schedules/overview) → tool must `update` on conflict |
| Schedules HTTP routes: `POST /api/schedules/:id/pause|resume`, permission `schedules:write` | ✅ | docs scheduled-workflows ("Both require the `schedules:write` permission"); `@mastra/core/dist/_types/@internal_auth/.../permissions.generated.d.ts:198-200` (`schedules:read/write/delete/execute`) |
| Scheduler auto-starts when a workflow declares a schedule **and** workers aren't disabled; `MASTRA_WORKERS=false` disables it | ✅ | `dist/mastra-B-GDpHtP.js:972-985` (env parsing), `:1252-1256` `#shouldEnableScheduler()` (`#hasScheduledWorkflow \|\| #schedulerRequested \|\| fs-agent schedules`) |
| Tool context carries the Mastra instance: `ToolExecutionContext.mastra?: MastraUnion` (+ top-level `requestContext`; conversation identity via **`context.agent?.{threadId,resourceId}`** — there is NO top-level `resourceId` on `ToolExecutionContext`, whose full field set is `mastra`/`requestContext`/`abortSignal`/`actor`/`workspace`/`browser`/`writer`/`agent`/`workflow`/`mcp`/`observe`) | ✅ | `@mastra/core/dist/tools/types.d.ts:461-486` (interface), `:145-151` (`AgentToolExecutionContext.threadId?/resourceId?`); `MastraUnion = { [K in keyof Mastra]: Mastra[K] }` (`dist/action/index.d.ts:16-18`) → `context.mastra?.getStorage()`, `context.mastra?.schedules` all available at runtime |
| Task tools currently persist nothing | ✅ | `src/mastra/domains/task-management/tools/create-task.ts:25`, `update-task.ts:26-31`, `schedule-task.ts:19` |
| **Correction to the gap report:** tools also emit **no** lifecycle events | ✅ | `grep eventBus src/mastra/domains/task-management/` matches only the two doc lies in `AGENTS.md` — `:22` ("each publishes its event on the shared bus") and `:28` ("Every tool mutation must emit the matching event via `eventBus.publish()`"); `events.ts` defines contracts never imported |
| `MastraCompositeStore.getStore()` only routes **fixed** built-in domain keys — there is **no custom-tables API** in 1.66.0 | ✅ | `@mastra/core/dist/storage/base.d.ts:229,277` (`getStore<K extends keyof StorageDomains>`); LibSQL domains list (`@mastra/libsql/dist/storage/index.d.ts:4-27`); docs/reference/storage/overview lists no custom-table mechanism — the gap analysis' "`getStore()` + drizzle custom tables" phrasing is **not** a shipped API and this spec corrects it (ADR-008, §3.1) |
| `LibSQLStore.client` is **private** (no raw-connection escape hatch); `PostgresStore` exposes `get pool(): Pool` | ✅ | `@mastra/libsql/dist/storage/index.d.ts:142-146`; `@mastra/pg/dist/storage/index.d.ts:88` |
| LibSQL adapter auto-creates **its own** tables (`init()` called by `new Mastra`; `disableInit` opt-out) — custom tables are NOT covered | ✅ | `@mastra/libsql/dist/storage/index.d.ts:97-107` + integrations/databases/libsql docs ("`init()` called automatically") |
| LibSQL `url: ':memory:'` works for tests (docs + runtime probe in this authoring session) | ✅ | integrations/databases/libsql docs; `new LibSQLStore({url:':memory:'}); await s.init()` OK |

### 3.1 Architecture decision — where the repository lives (ADR-008)

**Chosen pattern: a shared *connection factory*, a domain-owned *repository*.**

* `src/mastra/shared/config/db.ts` (new): exports `resolveDbTarget()` + lazy singleton
  `getAppDb(): Promise<AppDatabase | null>`. `storage.ts` is refactored so `buildStorage()` and
  `getAppDb()` share ONE env-resolution function (no logic duplication):
  `DATABASE_URL (postgres…) → { dialect:'pg', url }` → `LIBSQL_URL → { dialect:'libsql', url }` →
  `{ dialect:'libsql', url:'file:./mastra.db' }`.
  `AppDatabase` is a 4-method interface (`execute`, `query`, `close`, `dialect`) implemented with
  `@libsql/client` (`createClient`) and `pg` (`Pool`) — **both packages are already installed
  transitively** via `@mastra/libsql` / `@mastra/pg`; they get **promoted to direct dependencies** in
  `package.json` (explicit, never relying on hoisting). No new DB engine, no ORM (drizzle-orm is
  *not* installed — verified), no second server, same file/URL as Mastra storage.
* `src/mastra/domains/task-management/repo.ts` (new): all task SQL + `ensureTaskSchema()` lives
  **inside the domain** (vertical slice, ADR-001). It receives an `AppDatabase` as a parameter —
  it never imports shared/config/db lazily by accident; tools wire it explicitly.
* **Why not `context.mastra?.getStorage()` directly (the tempting option)?** Verified:
  `getStorage()` exposes only fixed domains via `getStore()` and `LibSQLStore` keeps its client
  `private` — there is no supported way to reach a custom table through it in 1.66.0. Reaching the
  Mastra instance would hit the same wall; reaching `src/mastra/index.ts` by import is a circular
  dependency. So: tools take **storage/db from the tool context where the platform provides it**
  (`context.mastra` for schedules; `getAppDb()` for rows) and nothing imports the composition root.
  `runTool()` (shared/tools/run-tool.ts:31-43) synthesizes a context with `mastra: undefined` →
  tools MUST degrade honestly: persistence without `mastra` still works (`getAppDb()` is env-driven);
  `schedule_task` returns a `SCHEDULING_UNAVAILABLE` error when `context.mastra` is absent (never a
  fake id). `runTool` gains an optional third argument `contextOverrides` (additive, typed) so unit
  and integration tests can inject a real `mastra`.

**ADR-008 (new file `docs/adr/008-application-data-in-mastra-storage.md`, Accepted on merge):**
"Application data in Mastra storage databases (custom tables, domain-owned repositories)" — context
(the gap analysis' `getStore()`+drizzle assumption is not a real API; decorative entity store),
options (a: piggyback on a built-in domain like `memory` — rejected, opaque + schema-coupled;
b: separate DB dependency — rejected, violates "no new DB dep"; c: chosen: same DATABASE_URL /
LibSQL file, thin `AppDatabase` from already-installed drivers, tables owned by domains),
consequences (custom tables are OUTSIDE Mastra's migration system — `ensureTaskSchema` must stay
additive/idempotent; retention/prune/close do not touch them; multi-process writers rely on
WAL/`busy_timeout` (LibSQL default 5000 ms, `LibSQLConfig.connectionTimeoutMs`) for local files).
Accepted ADRs are never edited; `docs/adr/README.md` index gains the line.
**Numbering (settled by the global cross-spec gate):** the seven Phase-5 specs pre-assign their
records so nothing collides at merge time — ADRs: 01→004, 02→005, 03→006, 04→007, **05→008
(this spec)**, 06→009, 07→010; root-`AGENTS.md` gotchas in phase-order merge: 01→#9, 02→#10,
04→#11, **05→#12 (this spec's gotcha, next free at merge time)**. **Renumber if the actual
execution order changes** (update in-text refs in the affected PR; the append-only /
never-edit-accepted-ADRs rule from `docs/adr/AGENTS.md` governs every case).

### 3.2 Task row schema (concrete)

Mapped 1:1 from `entities/task.ts:1-23` (`id, title, description?, status, priority, dueDate?,
createdAt, updatedAt, scheduleId?`) plus two operational columns. Dialect-portable DDL (valid for
LibSQL and Postgres; timestamps stored as ISO-8601 TEXT to avoid dialect drift — PROPOSAL,
alternative `TIMESTAMPTZ` documented in ADR-008):

```sql
CREATE TABLE IF NOT EXISTS app_tasks (
  id           TEXT PRIMARY KEY,           -- crypto.randomUUID() (Node >= 22.13)
  resource_id  TEXT NOT NULL DEFAULT 'default',
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL CHECK (status    IN ('pending','in-progress','completed')),
  priority     TEXT NOT NULL CHECK (priority  IN ('low','medium','high')),
  due_date     TEXT,                        -- ISO 8601
  schedule_id  TEXT,                        -- mastra.schedules row id once scheduled
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1   -- optimistic concurrency (Scenario 5)
);
CREATE INDEX IF NOT EXISTS idx_app_tasks_resource_status ON app_tasks (resource_id, status);
```

Table name prefixed `app_` to make ownership vs Mastra-managed tables visible at a glance.
`Task` interface stays the domain's public type; `entities/task.ts` gains `resourceId` +
`version` fields (optional on the TS interface for back-compat of the barrel export).

### 3.3 Repository interface (`domains/task-management/repo.ts`)

```ts
export interface CreateTaskInput { title: string; description?: string;
  priority?: TaskPriority; dueDate?: string; resourceId?: string }
export interface UpdateTaskPatch { title?: string; description?: string;
  status?: TaskStatus; priority?: TaskPriority; dueDate?: string; scheduleId?: string;
  expectVersion?: number }
export interface ListTasksFilter { resourceId?: string;
  status?: TaskStatus;          // exact-match filter
  excludeStatus?: TaskStatus;   // set-based filter (digest needs status ≠ completed)
  limit?: number /* default 20, max 100 */; }
export interface TaskRepository {
  ensureSchema(): Promise<void>;
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  listTasks(filter?: ListTasksFilter): Promise<Task[]>;
  /** null = row missing OR expectVersion mismatch (caller distinguishes via a follow-up getTask). */
  updateTask(id: string, patch: UpdateTaskPatch): Promise<Task | null>;
  attachSchedule(id: string, scheduleId: string): Promise<Task | null>;
}
export function createTaskRepository(db: AppDatabase): TaskRepository; // factory, test-seamable
```

### 3.4 Tool changes (before → after)

| Tool | Before (verified) | After |
|---|---|---|
| `create-task.ts` | `:25` id = `task_${Date.now()}_${Math.random()}`; persists nothing; no event | `const db = await getAppDb()`; `repo.createTask()` (UUID, `resource_id` from `context.agent?.resourceId ?? 'default'` — `ToolExecutionContext` has no top-level `resourceId`, §3.0); emits `task.created` **after** the commit; output gains `priority`, `dueDate` |
| `update-task.ts` | `:26` "In a real implementation…" comment; unconditional `{updated: true}` | `getTask` → null ⇒ `{updated:false, reason:'NOT_FOUND'}`; guarded `UPDATE … WHERE id=? AND version=?` ⇒ 0 rows ⇒ `reason:'CONFLICT'` + fresh row; emits `task.updated` (and `task.completed` when `status→completed`); no DB env (impossible — storage is never absent per `buildStorage` fallback) |
| `schedule-task.ts` | `:19` id = `schedule_${Date.now()}`; nothing created | Input: `{ taskId, schedule: {cron \| interval, timezone?, prompt?} }`. `interval` (`^\d+(m\|h\|d)$`) → cron (`*/N * * * *`, `0 */N * * *`, `0 0 */N * * *`) for back-compat; cron validated by the API. Requires `context.mastra` (else honest `SCHEDULING_UNAVAILABLE`). Verifies task exists. `mastra.schedules.create({ id: 'task-'+taskId, agentId: 'task-management-agent' /* NOT workflowId — agent reminder; row id normalizes to `agent_task-<slug(taskId)>`, schedules.d.ts:62-67 */, cron, prompt: 'Reminder…' })`; on duplicate-id error → `mastra.schedules.update()`. Writes `schedule_id` onto the task row; emits `task.scheduled` |
| `run-tool.ts` | context hard-coded `mastra: undefined` | optional `contextOverrides?: Partial<ToolExecutionContext>` third param (additive) |
| `agent.ts` | instructions promise "schedule tasks to run at specific intervals" | wording aligned with reality: schedules fire a **reminder prompt** into the agent (see Open Questions for the workflow-schedule alternative) |

**Note on schedule-task semantics (honest restriction):** the scheduler fires **agents** (prompt)
or **workflows** (inputData) — there is no "run an arbitrary Task row" primitive, and this agent
explicitly does not execute work (`agent.ts:18`). So `schedule_task` = an **agent reminder
schedule** (`agentId`-shaped `CreateScheduleInput`, threadless `agent.generate()` fire). This is
the first-class, verified capability; inventing "task execution" is out of scope. Caveat carried
into the tests (Scenario 4): observable agent fires require the `AgentScheduleWorker` plus a
provider key, and agent-schedule `run()` records no trigger row — assert the claim record, not a
conversation.

### 3.5 `daily-digest` workflow + declarative schedule

New `src/mastra/domains/task-management/workflows/daily-digest.ts`, registered in
`src/mastra/index.ts` `workflows` map (rule: unregistered = invisible). **LLM-free by design**
(so it fires in zero-config/provider-less mode — Scenario 3's principle applied to schedules):

```ts
export const dailyDigestWorkflow = createWorkflow({
  id: 'daily-digest',
  description: 'Cron-fired digest of open tasks (proves the scheduler path)',
  inputSchema: z.object({ resourceId: z.string().default('default'), date: z.string().optional() }),
  outputSchema: z.object({ date: z.string(), openCount: z.number(), lines: z.array(z.string()) }),
  schedule: {                       // single form → row id `wf_daily-digest`
    cron: '0 9 * * *',              // validated at construction (croner)
    timezone: 'UTC',                // explicit — host-tz default flagged in docs
    inputData: { resourceId: 'default' },
  },
})
  .then(collectOpenTasksStep)   // repo.listTasks({ excludeStatus: 'completed' }) — deterministic
  .then(buildDigestStep)        // markdown digest, logger.info, eventBus.publish('tasks.digest.ready')
  .commit();
```

`tasks.digest.ready` is added to `events.ts` (consumer wiring to the communication domain is a
later phase — the event just needs to exist and be published).

### 3.6 The LibSQL × evented-engine question — RESOLVED (verified)

Scheduled workflows are auto-promoted to the evented engine, which requires a workflow-storage
adapter supporting concurrent updates. **LibSQL qualifies.** Official doc quote
(docs/workflows/scheduled-workflows, "What `schedule` changes"):

> "The promotion means evented runs require a storage adapter with concurrent-update support,
> such as `@mastra/libsql`; otherwise, `createRun()` throws a clear error that points to the
> `schedule` field."

Corroborated in code, installed version:
* `WorkflowsStorage.supportsConcurrentUpdates(): boolean` — abstract capability flag
  (`@mastra/core/dist/storage/domains/workflows/base.d.ts:6`); LibSQL overrides it
  (`@mastra/libsql/dist/storage/domains/workflows/index.d.ts:14`) and **returns `true` at runtime**
  (probed live: `new LibSQLStore({url:':memory:'}) → getStore('workflows').supportsConcurrentUpdates() === true`).
* The engine's guard error text itself recommends LibSQL: "Switch to an adapter that does (for
  example @mastra/libsql)…" (`dist/agent-CEHR0Wd8.js:8210`).
* Schedules storage domain: LibSQL implements it (`index.d.ts:19` `SchedulesLibSQL`;
  runtime probe: `getStore('schedules')` present) and the reference page lists
  `@mastra/libsql` among supported schedule adapters.

**Zero-config consequence:** on `file:./mastra.db` the whole path (declarative row + evented run
+ pause/resume) works in one process; concurrent writers are serialized by SQLite with
`busy_timeout` (default 5000 ms). The real zero-config caveat is NOT the engine but the workers:
with `MASTRA_WORKERS=false` (the current `.env.example` default), `#workersDisabled` ⇒ the
scheduler never starts ⇒ `wf_daily-digest` is registered but never fires. See 3.8.

### 3.7 Migration / ensureTables story

Verified behavior: passing storage to `new Mastra` auto-calls `init()` creating **Mastra's**
tables only (`disableInit` exists to move even those to CI/CD). `app_tasks` is invisible to that
system ⇒ the repository owns an idempotent `ensureTaskSchema()` (`CREATE TABLE IF NOT EXISTS` +
index, identical DDL both dialects) called **lazily once per process on first repo use**
(so `test:smoke` — which only constructs the instance — never touches it; boot stays clean).
Future column additions = additive `ensureTaskSchema` migrations documented in ADR-008
(never destructive; Mastra's `prune()`/retention intentionally does not cover app tables).

### 3.8 Env & banner (STATEMENT: no new env vars)

* **No new environment variables are introduced** (the same `DATABASE_URL` / `LIBSQL_URL` /
  fallback `file:./mastra.db` resolve storage AND app tables).
* `.env.example` correction (dead-knob fix, gap §1.3 spirit): the blanket
  `MASTRA_WORKERS=false` becomes a commented explanation — unset = scheduler auto-starts with
  declarative schedules; `false` = no scheduling in-process; dedicated scheduler worker per spec 02
  (`MASTRA_WORKERS=scheduler`, exactly one instance).
* Banner: new `ServiceStatus` line via the existing registry — `Schedules` — active when a
  scheduler will run here (workers not disabled AND a scheduled workflow or imperative schedule
  exists), detail e.g. `daily-digest @ 0 9 * * * UTC (row wf_daily-digest)`; inactive ⇒
  `○ Schedules  inactive — MASTRA_WORKERS=false; wf_daily-digest will NOT fire (run one scheduler worker, see docs)` — the
  single-instance warning lives in that line + root `AGENTS.md` gotcha **#12 (next free at merge time)**.
* **`.env.example` coordination with spec 02:** spec 02 only ADDS a `REDIS_URL` line + header
  (near :67) and does NOT re-pin `MASTRA_WORKERS=false`; this spec's rewrite targets the Workers
  block (:65-67) — rebase on the post-02 layout, keep the unset default + explanation, and leave
  02's `REDIS_URL` line untouched.

### 3.9 Estimated Impact

~**1,300–1,600 LOC** across ~**20 files** (src ≈ 600 / tests ≈ 550 / docs ≈ 350):
new — `shared/config/db.ts`, `task-management/repo.ts`, `workflows/daily-digest.ts`, ADR-008,
`update-task`/`schedule-task` unit tests, task-persistence + schedules integration tests;
touched — `storage.ts` (extract resolver), `service-status.ts`, 3 tools, `entities/task.ts`,
`events.ts`, domain `index.ts`, `src/mastra/index.ts` (workflows map), `run-tool.ts`,
`create-task.test.ts`, `.env.example`, README (feature + API-route + table rows), 3×AGENTS.md,
`docs/TESTING.md`.

* **Definition of Done (DoD):**
  - [ ] Scenarios 1–5 covered: unit (repo + tools on `:memory:` LibSQL via `createClient`,
        and on `@mastra/libsql` `:memory:` for the schedules-domain path), gated integration
        (`describe.skipIf(!process.env.DATABASE_URL)`) re-running the repo suite against Postgres;
        schedules integration asserts a real `mastra.schedules.create()` row (`agent_task-…` for
        the tool, `wf_daily-digest` for declarative), `run()`'s `{scheduleId, claimId,
        scheduledFireAt}` claim record + `list()` state (NOT an actual agent fire — see
        Scenario 4), and the `app_tasks` roundtrip; restart-durability test
        = write → close client → reopen same `file:` path → read.
  - [ ] `daily-digest` registered in `workflows` map; `GET /api/workflows` lists it;
        boot with scheduler enabled creates `wf_daily-digest` visible via `GET /api/schedules`;
        pause/resume — Studio schedule detail page, or raw `POST /api/schedules/wf_daily-digest/pause|resume`
        (no `@mastra/client-js` dep yet, §Phase 1 KR2) — verified manually by the user.
  - [ ] **Fake-assert inventory (existing tests/docs corrected):**
        1. `tests/unit/domains/task-management/tools/create-task.test.ts:21` (status from return
           value only) → additionally asserts the persisted row (`getTask` on `:memory:`);
           `:37-42` unique-ids test → asserts two real rows.
        2. `update-task`'s unconditional `updated: true` and `schedule-task`'s
           `schedule_${Date.now()}` → covered by NEW tests incl. NOT_FOUND / CONFLICT /
           duplicate-schedule-update; no silent fake may survive.
        3. Domain `AGENTS.md` — BOTH doc claims (:22 "each publishes its event on the shared bus"
           and :28 "Every tool mutation must emit the matching event via `eventBus.publish()`") →
           made TRUE (tools publish; a unit test subscribes and asserts), and both lines corrected
           as part of the doc update.
        4. `tests/AGENTS.md` line describing create-task.test.ts as covering "event emission" →
           true after this change; evals file unaffected (structural).
        5. `mastra-boilerplate/src/mastra/index.ts`-banner docs (README §how-it-works) updated
           with the Schedules line.
  - [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test:all` (smoke zero-config still boots
        with the scheduled workflow registered), `timeout 15 npm run dev` shows banner +
        `/api/schedules` responds; `@libsql/client` and `pg` declared in `package.json` deps.
  - [ ] Docs: `docs/adr/008-application-data-in-mastra-storage.md` (ADR-008 per the §3.1 settled
        numbering), root `AGENTS.md` gotcha **#12 (next free at merge time)** — text: "`MASTRA_WORKERS=false`
        silently disables schedules" + "custom tables live beside Mastra's, migrations are ours",
        task-management `AGENTS.md` (repo.ts/db.ts rules), README feature bullets.
  - [ ] Cross-spec doc-sync: spec 01's Compatibility statement claims "no change to
        `MASTRA_WORKERS=false` dev topology" while §3.8 flips that default — if spec 01 has
        merged first, amend its statement in the same PR wave (specs are DRAFT-editable; only
        *accepted ADRs* are append-only).
  - [ ] Guardrails: no domain→sibling-domain import (ADR-001 lint of conscience + eslint);
        no `console.*`; `shared/` never imports `domains/`; no hard-coded model (daily-digest
        uses none); unit tests must pass with `DATABASE_URL` unset and no API keys.
  - [ ] Work on branch `feat/task-persistence-and-schedules` (root AGENTS.md conventions);
        commits staged every 400–800 LOC, never exceeding 1400 LOC per commit
        (suggested split: `feat: shared db factory + task repository` → `feat: persist task tools`
        → `feat: real schedules in task tools` → `feat: daily-digest scheduled workflow` → `test:` / `docs:`).

---

## Phase 4: Risks & Open Questions

* **Risks:**
  1. **Scheduler silently off / double-fires.** `MASTRA_WORKERS=false` (today's `.env.example`
     default) registers `wf_daily-digest` but never fires it — silent half-feature; conversely two
     processes with the scheduler enabled (e.g. 3 API replicas + a scheduler worker, spec-02
     topology drift) race on due-row claims. *Mitigation:* §3.8 banner line names the inactive state
     and the expected `wf_daily-digest` row; `.env.example` fix; docker/AGENTS + gotcha #12 restate the
     single-scheduler rule (prod compose already pins `replicas: 1` —
     `docker-compose.prod.yml:106`); the scheduler's claim-based tick (claimId
     `sched_<scheduleId>_<timestamp>`) is documented, not re-implemented.
  2. **Custom-table lifecycle drifts from Mastra-managed migrations.** `ensureTaskSchema` runs
     outside `init()`/`disableInit` semantics; a hand-edited or stale schema yields runtime SQL
     errors the adapters know nothing about; future `ALTER`s must be additive-only.
     *Mitigation:* single idempotent DDL constant + `version` column reserved for optimistic
     locking only; ADR-008 states the "additive or migrate-in-CI" rule; integration CI catches
     dialect divergence by running the same suite on Postgres.
  3. **Zero-config evented runs on a shared file.** LibSQL passes the concurrency requirement
     (single process, WAL). Multi-process against one `file:` DB is the actual weak spot:
     busy-timeouts under load, and the evented engine's in-process pubsub cannot cross processes.
     *Mitigation (v1 scope):* docs state single-process for LibSQL file mode; multi-process is
     explicitly spec 02's Postgres + Redis-pubsub territory; smoke/unit tiers never rely on
     multi-process firing.

* **Open Questions / Decisions:**
  * **Per-resource task isolation** — global table vs `resource_id` column. **Recommendation:
    include `resource_id` now** (as designed, defaulted to `'default'`, fed from
    `context.agent?.resourceId` — the platform-supplied slot on the tool context, §3.0); a
    global-only table would need a second migration to become multi-user. Owner: implementing
    agent at spec kickoff (decision pre-approved unless objected to).
  * **Reminder-schedule vs workflow-schedule for `schedule_task`** — this spec chose agent
    reminder (matches "you track tasks, you do not perform them"). If the team later wires a
    task-execution workflow, the same tool input can switch `agentId → workflowId` with no schema
    change. Owner: product owner before Phase 6.
  * **`daily-digest` timezone** — hard-coded `UTC` now; an env-driven default (`SCHEDULE_TZ`) is
    deliberately NOT added (no-new-env statement); revisit with the notifications phase.
    Owner: the notifications-phase spec author (decide alongside digest fan-out, pre-Phase 6).

---

## Phase 5: Non-Functional Requirements

* **Performance:** `create_task`/`update_task` tool roundtrip (single INSERT/UPDATE + commit)
  p95 **< 50 ms on local LibSQL file**; p95 < 15 ms on `:memory:` (PROPOSAL — thresholds to be
  calibrated against CI hardware the first time they fail; they are guardrails, not SLOs).
  `listTasks(limit ≤ 100)` never full-scans (index 3.2).
* **Security:** `/api/schedules*` (list/pause/resume) inherits the spec-01 auth layer exactly as
  every other route; under Fine-Grained Authorization the write routes demand `schedules:write`
  (verified permission ids). App tables are reachable only via the domain repository — no new
  public route is added by this spec. Task rows carry no secrets; `prompt` field of schedules is
  user-authored text, stored as-is (observability sensitive-data filter already covers spans).
* **Reliability / Availability:** with **exactly one** scheduler instance, a declarative schedule
  fires **at most once per cron tick** (claim-based due-row pickup; idempotent pause/resume per
  docs); a process kill loses no committed task row (SQLite file / Postgres durability — asserted
  by the reopen-after-close test); missed fires are never backlogged (resume recomputes
  `nextFireAt` from now — documented behavior, not a bug to fix); tool failures return typed
  reasons (`NOT_FOUND`, `CONFLICT`, `SCHEDULING_UNAVAILABLE`) instead of fake success.
* **Accessibility / Compatibility:** Studio `/workflows/schedules` (global + `?workflowId=daily-digest`)
  and trigger-history views work out of the box for the new schedule — verification is a manual,
  user-side check (per repo policy). Zero-config promise intact: boot, tests and the whole feature
  work with no env vars (LibSQL fallback), no API keys, `test:smoke` untouched by the scheduled
  workflow at construction time (scheduler only starts in server/worker mode, never on import).

---

*End of spec — all citations above were verified on 2026-09 against the installed
`node_modules` and mastra.ai docs (`/docs/workflows/scheduled-workflows`, `/docs/harness/schedules`,
`/reference/schedules/overview`, `/reference/storage/overview`, `/integrations/databases/libsql`).*
