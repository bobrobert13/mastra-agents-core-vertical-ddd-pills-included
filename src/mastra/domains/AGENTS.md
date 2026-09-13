<!-- Parent: ../../../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# domains

## Purpose

Container for the four vertical slices. Each domain is self-contained: agent, tools, workflows, scorers, entities, events. **Domains never import from sibling domains** — cross-domain communication goes through the shared event bus (`src/mastra/shared/events/event-bus.ts`).

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `research/` | Web research agent: search, fetch, summarize, deep-research workflow (see `research/AGENTS.md`) |
| `task-management/` | Task/schedule agent with Task entity and lifecycle events (see `task-management/AGENTS.md`) |
| `file-operations/` | Filesystem agent: read/write/edit file tools (see `file-operations/AGENTS.md`) |
| `communication/` | Minimal agent: structured `ask_user` tool (see `communication/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- A new domain mirrors this shape: `agent.ts` (scope + guard wired), `tools/`, optional `workflows/`, `scorers/`, `entities/`, `events.ts`, and `index.ts` barrel exporting the agent, its `*Scope` and `*ScopeGuard`.
- If you catch yourself importing `../other-domain/...`, stop — publish/consume an event instead.
- Each domain's `index.ts` is the only allowed import surface from outside the domain.

### Common Patterns
- Tools: `createTool()` + Zod input/output schemas + `logger` (never `console`).
- Agents: `model: agentModel.<key>()` from `shared/config/model.ts` — never a hard-coded `provider/model-id` string; the provider is chosen entirely by env vars.
- **Agent scope (hard rule)**: every domain defines and exports its `DomainScope` (plain data, siblings without imports), wires `createScopeGuard(scope)` into `inputProcessors` and builds instructions via `scopedInstructions(scope, body)`. A domain agent that answers off-topic is a defect, not a quirk (root AGENTS.md gotcha #7).

## Dependencies

### Internal
- `shared/` (logger, event bus) — the only allowed upward import

<!-- MANUAL: -->
