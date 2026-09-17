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
| `knowledge/` | Chat-with-docs slice: `index-knowledge` workflow + `search_knowledge` tool — **no agent on purpose** (spec 03; see `knowledge/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- New domain (or agent): mirror the four one-responsibility files — `scope.ts` (the `DomainScope`, reading `agentName`/`scope`/siblings from `shared/agents/domain-catalog.ts`), `config.ts` (the knobs as a `DomainAgentSettings`: `modelKey`, `maxSteps`, `connectors`, `disableResponseCache`), `instructions.ts` (the capability body only — `scopedInstructions()` prepends the hard boundary) and `agent.ts` (~20 LOC: the builder call plus the `<d>Agent` / `<d>ScopeGuard` / `<d>SecurityStack` exports the structural tests reference). Plus `tools/`, optional `workflows/` (steps in `workflows/steps/`, shared shapes in `workflows/schemas.ts`), `scorers/`, `entities/`, `events.ts` and `index.ts`.
- Add the domain to `shared/agents/domain-catalog.ts` (`agentName` / `scope` / short `description`) — that ONE table is what every other domain lists as a sibling, so nothing is copied around.
- Capabilities are DECLARED, not hand-wired: `connectors` in `config.ts` — `memory` (`'basic'` default | `'observational'`), `rag` (**opt-in**: `true` attaches `search_knowledge` from the root registry; without it the agent never gets it, even when the tool is registered) and `mcp` (the `MCP_SERVERS` routing key). Local `tools` win on key collision.
- If you catch yourself importing `../other-domain/...`, stop — publish/consume an event instead (the only cross-domain reads allowed are the plain-data catalog and the root registry through `connectors`).
- Each domain's `index.ts` is the only allowed import surface from outside the domain.
- Keep every file ≤150 LOC (`tests/unit/structure/file-size.test.ts` fails the build if a domain file grows past it).

### Common Patterns
- Tools: `createTool()` + Zod input/output schemas + `logger` (never `console`).
- Agents: `model: agentModel.<key>()` from `shared/config/model.ts` — never a hard-coded `provider/model-id` string; the provider is chosen entirely by env vars.
- **Agent scope (hard rule)**: every domain defines and exports its `DomainScope` (plain data, siblings without imports), wires `createScopeGuard(scope)` into `inputProcessors` and builds instructions via `scopedInstructions(scope, body)`. A domain agent that answers off-topic is a defect, not a quirk (root AGENTS.md gotcha #7). The voice of its refusal is declared per domain in `refusal.tone` (`warm` | `formal` | `neutral`), overriding the global `SCOPE_GUARD_TONE`.

## Dependencies

### Internal
- `shared/` (logger, event bus) — the only allowed upward import

<!-- MANUAL: -->
