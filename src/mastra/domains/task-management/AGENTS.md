<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# task-management

## Purpose

Task and schedule vertical slice: CRUD-ish agent over a Task entity with lifecycle events (`created`, `updated`, `completed`, `scheduled`) and a recurring-schedule tool. Reference implementation for domain entities + event emission.

## Key Files

| File | Description |
|------|-------------|
| `agent.ts` | `task-management-agent` / "Task Management Agent"; model via `agentModel.tasks()` — env-driven; Memory + observationalMemory via `memoryModel()` |
| `entities/task.ts` | `Task` interface; `TaskStatus` = pending \| in-progress \| completed; `TaskPriority` = low \| medium \| high; `TaskSchedule` |
| `events.ts` | `task.created` / `task.updated` / `task.completed` / `task.scheduled` contracts |
| `index.ts` | Barrel export |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `tools/` | `create-task.ts`, `update-task.ts`, `schedule-task.ts` + barrel — each publishes its event on the shared bus |

## For AI Agents

### Working In This Directory
- Persisted state goes through Mastra storage (configured centrally); do not open DB connections here.
- Every tool mutation must emit the matching event via `eventBus.publish()` — integration tests listen for these.

### Testing Requirements
- Unit: `tests/unit/domains/task-management/` (agent identity + create-task tool).
- Evals: `tests/evals/task-management.eval.test.ts`.

## Dependencies

### Internal
- `shared/logger.ts`, `shared/events/event-bus.ts`

### External
- `@mastra/core/agent`, `@mastra/core/tools`, `@mastra/memory`, `zod`

<!-- MANUAL: -->
