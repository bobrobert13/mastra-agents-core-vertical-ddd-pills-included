<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-17 -->
# task-management

## Purpose

Task and schedule vertical slice: a Task entity backed by a REAL repository
(`app_tasks` custom table via `shared/config/db.ts` — ADR-008, now a `repo/`
directory), lifecycle events the tools genuinely publish (`task.created` /
`task.updated` / `task.completed` / `task.scheduled` / `tasks.digest.ready`),
an agent-reminder scheduling tool wired to `mastra.schedules`, and a
declaratively-scheduled LLM-free `daily-digest` workflow. Reference
implementation for domain-owned persistence + event emission.

## Key Files

| File | Description |
|------|-------------|
| `agent.ts` | Composition root: `buildDomainAgent({ scope, instructionsBody, tools: { create_task, update_task, schedule_task }, ...taskManagementSettings })`. Fixes the three structural-test exports: `taskManagementAgent`, `taskManagementScopeGuard`, `taskManagementSecurityStack` |
| `scope.ts` | `taskManagementScope` (`DomainScope`): `agentName`/`scope`/`siblings` read from `shared/agents/domain-catalog.ts` (`DOMAIN_CATALOG['task-management']` + `siblingsOf('task-management')`); only `outOfScopeExamples` and `refusal: { tone: 'warm' }` are local |
| `config.ts` | `taskManagementSettings` (`modelKey: 'tasks'`, `maxSteps: 30`, `connectors: { memory: 'observational' }`) + domain constants: `TASK_MANAGEMENT_AGENT_ID`, `TASK_SCHEDULE_ID_PREFIX`, `TASK_INTERVAL_RE`, `DIGEST_SCHEDULE_CRON` / `DIGEST_SCHEDULE_TIMEZONE` |
| `instructions.ts` | `taskManagementInstructions` — capability body; `scopedInstructions()` prepends the scope/refusal block |
| `entities/task.ts` | `Task` (+ optional `resourceId`/`version`); `TaskStatus` = pending \| in-progress \| completed; `TaskPriority` = low \| medium \| high; `TaskSchedule` (legacy shape) |
| `events.ts` | `task.created` / `task.updated` / `task.completed` / `task.scheduled` / `tasks.digest.ready` contracts — published for real by the tools/steps |
| `index.ts` | Barrel: agent, scope/guard/security stack, tools, entity/event types, `createTaskRepository` (+ repo types via `./repo`), `dailyDigestWorkflow` |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `repo/` | Repository split into four modules under the SAME public path `.../task-management/repo`: `index.ts` (barrel — re-exports exactly what `repo.ts` did), `schema.ts` (`CREATE_TABLE_SQL`/`CREATE_INDEX_SQL`, `ADDITIVE_COLUMN_MIGRATIONS`, memoized `createEnsureSchema`), `types.ts` (contracts: `CreateTaskInput`, `UpdateTaskPatch`, `ListTasksFilter`, `TaskRepository`, `TaskRow`), `task-repository.ts` (`createTaskRepository(db)` — full CRUD, dialect-portable placeholders) |
| `schedule/` | `interval.ts` (`intervalToCron`: `15m`/`1h`/`2d` → cron via `TASK_INTERVAL_RE`), `schemas.ts` (`schedule_task` I/O schemas + the typed `scheduleFailureReasonSchema` enum), `sync.ts` (`syncTaskSchedule` create-or-update, idempotent per task; recovers from the non-idempotent storage API's `SCHEDULES_ID_EXISTS` race) |
| `entities/` | `task.ts` — the `Task` entity + `TaskStatus`/`TaskPriority` enums and the legacy `TaskSchedule` shape |
| `handlers/` | `errors.ts` — `TaskManagementError` (abstract, `domain='task-management'`) over `shared/handlers`' `AppError`, plus the concrete codes (`TASK_NOT_FOUND`, `TASK_CONFLICT` + `current`, `INVALID_SCHEDULE`, `SCHEDULING_UNAVAILABLE`, `SCHEDULE_ERROR`, `PERSISTENCE_UNAVAILABLE`, `TASK_MANAGEMENT_ERROR`) and `toTaskManagementError` (normalizer over `toAppError`); `responses.ts` — `TaskResult<T>` (`AppResult` over `TaskManagementError`) + `taskOk`/`taskFail` and the `reason` adapters (`toUpdateFailureReason`, `toScheduleFailureReason`) |
| `functions/` | Pure/effectful logic extracted from the tools: `schedule-spec.ts` (`resolveScheduleSpec` — nested-wins-over-flat spec resolution, interval → cron), `schedule-task.ts` (`executeScheduleTask` — spec → runtime → db → task → schedule ordering), `update-task.ts` (`buildTaskChanges` + `executeTaskUpdate` guarded write) + barrel |
| `tools/` | Thin adapters (~45 LOC each) over `functions/`: `create-task.ts` (INSERT + `task.created`; `resourceId` from `context.agent?.resourceId ?? 'default'`; output carries priority/dueDate), `update-task.ts` (maps `executeTaskUpdate`'s typed result to the schema; honest `NOT_FOUND` / `CONFLICT`, rethrows infra failures), `schedule-task.ts` (maps `executeScheduleTask`; real agent-reminder schedule via `context.mastra.schedules` — id `task-<taskId>`, normalized by the API to `agent_task-<slug>`; degrades `SCHEDULING_UNAVAILABLE` without the runtime; interval → cron for back-compat) + barrel |
| `workflows/` | `daily-digest.ts` (composition only, ~38 LOC: `collect-open-tasks` → `build-digest`; re-exports `collectOpenTasksStep`, `collectOpenTasks`, `buildDigestStep`, `buildDigest`, `DigestWindow` so the historic import surface is unchanged; declares `schedule: { cron, timezone }` → storage row `wf_daily-digest`; **must be registered** in `src/mastra/index.ts` `workflows` map; publishes `tasks.digest.ready`), `schemas.ts` (shared inter-step Zod — `DigestWindow`, `openTaskSchema`, `dailyDigestInputSchema`), `steps/{collect-open-tasks,build-digest}.ts` (one step per module) |

## For AI Agents

### Working In This Directory
- Persistence goes through `shared/config/db.ts` → `getAppDb()` (same URL
  resolution as Mastra storage: `DATABASE_URL` postgres → pg; `LIBSQL_URL` →
  libsql; fallback `file:./mastra.db`). Never open ad-hoc connections.
  `app_tasks` is owned by `repo/schema.ts` and lives OUTSIDE Mastra's migration
  system — future column additions = entries in `ADDITIVE_COLUMN_MIGRATIONS`
  (ADR-008; root `AGENTS.md` gotcha #12). Mastra prune/retention never
  touches app tables.
- Every tool mutation emits its event via `eventBus.publish()` AFTER the
  commit — unit tests subscribe and assert this. No fake success: tools
  return typed reasons (`NOT_FOUND`, `CONFLICT`, `SCHEDULING_UNAVAILABLE`,
  `INVALID_SCHEDULE`, `TASK_NOT_FOUND`, `SCHEDULE_ERROR`) instead of
  fabricated ids.
- `schedule_task` needs `context.mastra` (platform schedules service); in
  `runTool` direct calls inject it via `contextOverrides` or the tool
  honestly degrades — never fake a schedule row.
- Schedules only FIRE when a scheduler runs: `MASTRA_WORKERS=false` silently
  disables it (`wf_daily-digest` registers but never fires); exactly ONE
  scheduler instance across the fleet.

### Connectors & Domain Table
- Connectors are DECLARED in `config.ts` (`taskManagementSettings.connectors`), never hand-wired in `agent.ts`. `memory: 'observational'` replaces the retired `enableObservationalMemory` flag.
- RAG is opt-in: an agent receives `search_knowledge` ONLY when it declares `connectors: { rag: true }` in its `config.ts` — without that key it does not get the tool even though it stays registered in the root Mastra `tools` registry (`src/mastra/index.ts`). `taskManagementSettings` declares no `rag`, so this agent does not receive it.
- The domain table (agent name, long scope line, sibling descriptions) lives once in `shared/agents/domain-catalog.ts`; `scope.ts` reads `DOMAIN_CATALOG['task-management']` + `siblingsOf('task-management')` — never re-copy sibling strings locally.

### Testing Requirements
- Unit (`tests/unit/domains/task-management/`): `repo.test.ts` on `:memory:`
  LibSQL (CRUD, optimistic-lock conflict, resource scoping, reopen-after-close
  file durability); tool tests assert persisted rows + events (`LIBSQL_URL
  = ':memory:'` + `resetAppDb()`); `schedule-task.test.ts` uses a fake
  `schedules` stub through `runTool`'s third `contextOverrides` argument;
  `workflows/daily-digest.test.ts` executes the exported steps directly.
- Structural ratchet: `tests/unit/structure/file-size.test.ts` caps every file
  under `domains/` at **150 LOC** (no allowlist for domains; `shared/` is 200
  with a shrinking allowlist). This domain sits right at the limit — split big
  files by responsibility (`agent`/`scope`/`config`/`instructions`/`steps`/
  `repo`/`schedule`) rather than growing one.
- Integration (`tests/integration/task-persistence-schedules.test.ts`): the
  repo suite re-run on PostgreSQL is gated `skipIf(!DATABASE_URL postgres)`;
  the offline `mastra.schedules` probe asserts `agent_` id normalization,
  `list()` state and `run()`'s claim record `{ scheduleId, claimId,
  scheduledFireAt }` (NOT an actual agent fire — Scenario 4).
- Evals: `tests/evals/task-management.eval.test.ts` (structural, offline).

## Dependencies

### Internal
- `shared/logger.ts`, `shared/events/event-bus.ts`, `shared/config/db.ts`
  (`getAppDb` / `AppDatabase` — shared connection factory, domain-owned tables),
  `shared/agents/build-agent.ts` (`buildDomainAgent`), `shared/agents/domain-catalog.ts`,
  `shared/processors/security-stack.ts`

### External
- `@mastra/core/tools`, `@mastra/core/workflows`, `@mastra/core/schedules` (types), `zod`;
  the `Agent`/memory packages arrive via `shared/agents/build-agent.ts`, and
  DB drivers arrive only via `shared/config/db.ts` (`@libsql/client`, `pg`)

<!-- MANUAL: -->
