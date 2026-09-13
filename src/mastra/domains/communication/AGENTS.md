<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# communication

## Purpose

Smallest vertical slice: agent + one structured-interaction tool. Reference implementation for suspend/resume style UX (`ask_user`) and the floor template for new domains.

## Key Files

| File | Description |
|------|-------------|
| `agent.ts` | `communication-agent` / "Communication Agent"; model via `agentModel.comms()` — env-driven; exports `communicationScope` + `communicationScopeGuard` (hard scope enforcement) |
| `index.ts` | Barrel export |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `tools/` | `ask-user.ts` — presents structured questions/options to the user + barrel |

## For AI Agents

### Working In This Directory
- Keep this slice minimal on purpose — it demonstrates how small a valid domain can be. Don't add unrelated tools here.

### Testing Requirements
- Agent-identity unit test pattern applies if tests are added (`id`, `name`, `model` only — Agent props aren't public).

## Dependencies

### External
- `@mastra/core/agent`, `@mastra/core/tools`, `zod`

<!-- MANUAL: -->
