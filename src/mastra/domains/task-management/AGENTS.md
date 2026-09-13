<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-26 (Spec 05) -->
# task-management

## Purpose

Task and schedule vertical slice: a Task entity backed by a REAL repository
(`app_tasks` custom table via `shared/config/db.ts` — ADR-008), lifecycle
events the tools genuinely publish (`task.created` / `task.updated` /
`task.completed` / `task.scheduled` / `tasks.digest.ready`), an agent-reminder
scheduling tool wired to `mastra.schedules`, and a declaratively-scheduled
LLM-free `daily-digest` workflow. Reference implementation for domain-owned
persistence + event emission.

## Key Files

| File | Description |
|------|-------------|
| `agent.ts` | `task-management-agent` / "Task Management Agent"; model via `agentModel.tasks()` — env-driven; Memory + observationalMemory via `memoryModel()`; exports `taskManagementScope` + `taskManagementScopeGuard` (hard scope enforcement) |
| `repo.ts` | `createTaskRepository(db)` over the `app_tasks` table (spec 05 §3.2/§3.3): UUID ids, `resource_id` (default `'default'`), `version` optimistic-lock column, ISO-8601 TEXT timestamps; `ensureSchema()` idempotent + additive (one DDL for LibSQL and Postgres); dialect-portable placeholders |
| `entities/task.ts` | `Task` (+ optional `resourceId`/`version`); `TaskStatus` = pending \| in-progress \| completed; `TaskPriority` = low \| medium \| high; `TaskSchedule` (legacy shape) |
| `events.ts` | `task.created` / `task.updated` / `task.completed` / `task.scheduled` / `tasks.digest.ready` contracts — published for real by the tools/steps |
| `index.ts` | Barrel: agent, tools, entity/event types, `createTaskRepository` (+ repo types), `dailyDigestWorkflow` |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `tools/` | `create-task.ts` (INSERT + `task.created`; `resourceId` from `context.agent?.resourceId ?? 'default'`; output carries priority/dueDate), `update-task.ts` (guarded `UPDATE … WHERE id=? AND version=?`; honest `NOT_FOUND` / `CONFLICT` outcomes + current row; emits `task.updated`, plus `task.completed` on →completed), `schedule-task.ts` (real agent-reminder schedule via `context.mastra.schedules` — id `task-<taskId>`, normalized by the API to `agent_task-<slug>`; create-or-update = idempotent tool over a throwing API; degrades `SCHEDULING_UNAVAILABLE` without the runtime; interval `15m/1h/2d` → cron for back-compat; writes `schedule_id` onto the task row; emits `task.scheduled`) + barrel |
| `workflows/` | `daily-digest.ts`: 2-step LLM-free digest (`collect-open-tasks` → `build-digest`, uses `listTasks({ excludeStatus: 'completed' })`), declares `schedule: { cron: '0 9 * * *', timezone: 'UTC' }` → storage row `wf_daily-digest`; **must be registered** in `src/mastra/index.ts` `workflows` map; publishes `tasks.digest.ready` |

## For AI Agents

### Working In This Directory
- Persistence goes through `shared/config/db.ts` → `getAppDb()` (same URL
  resolution as Mastra storage: `DATABASE_URL` postgres → pg; `LIBSQL_URL` →
  libsql; fallback `file:./mastra.db`). Never open ad-hoc connections.
  `app_tasks` is owned by `repo.ts` and lives OUTSIDE Mastra's migration
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

### Testing Requirements
- Unit (`tests/unit/domains/task-management/`): `repo.test.ts` on `:memory:`
  LibSQL (CRUD, optimistic-lock conflict, resource scoping, reopen-after-close
  file durability); tool tests assert persisted rows + events (`LIBSQL_URL
  = ':memory:'` + `resetAppDb()`); `schedule-task.test.ts` uses a fake
  `schedules` stub through `runTool`'s third `contextOverrides` argument;
  `workflows/daily-digest.test.ts` executes the exported steps directly.
- Integration (`tests/integration/task-persistence-schedules.test.ts`): the
  repo suite re-run on PostgreSQL is gated `skipIf(!DATABASE_URL postgres)`;
  the offline `mastra.schedules` probe asserts `agent_` id normalization,
  `list()` state and `run()`'s claim record `{ scheduleId, claimId,
  scheduledFireAt }` (NOT an actual agent fire — Scenario 4).
- Evals: `tests/evals/task-management.eval.test.ts` (structural, offline).

## Dependencies

### Internal
- `shared/logger.ts`, `shared/events/event-bus.ts`, `shared/config/db.ts`
  (`getAppDb` / `AppDatabase` — shared connection factory, domain-owned tables)

### External
- `@mastra/core/agent`, `@mastra/core/tools`, `@mastra/core/workflows`,
  `@mastra/core/schedules` (types), `@mastra/memory`, `zod`;
  DB drivers arrive only via `shared/config/db.ts` (`@libsql/client`, `pg`)

<!-- MANUAL: -->
