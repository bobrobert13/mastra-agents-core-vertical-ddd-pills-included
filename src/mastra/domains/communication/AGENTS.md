<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-17 -->
# communication

## Purpose

Smallest vertical slice: agent + one structured-interaction tool. Reference implementation for suspend/resume style UX (`ask_user`) and the floor template for new domains (the minimal `scope.ts`/`config.ts`/`instructions.ts`/`agent.ts` shape).

## Key Files

| File | Description |
|------|-------------|
| `agent.ts` | Composition root: `buildDomainAgent({ scope, instructionsBody, tools: { ask_user }, ...communicationSettings })`. Fixes the three structural-test exports: `communicationAgent`, `communicationScopeGuard`, `communicationSecurityStack` |
| `scope.ts` | `communicationScope` (`DomainScope`): `agentName`/`scope`/`siblings` read from `shared/agents/domain-catalog.ts` (`DOMAIN_CATALOG.communication` + `siblingsOf('communication')`); only `outOfScopeExamples` and `refusal: { tone: 'warm' }` are local |
| `config.ts` | `communicationSettings` (`modelKey: 'comms'`, `maxSteps: 10`, `connectors: { memory: 'basic' }`) |
| `instructions.ts` | `communicationInstructions` — capability body; `scopedInstructions()` prepends the scope/refusal block |
| `index.ts` | Barrel export (agent, scope, guard, security stack, settings, instructions, tool) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `tools/` | `ask-user.ts` — presents structured questions/options to the user + barrel |

## For AI Agents

### Working In This Directory
- Keep this slice minimal on purpose — it demonstrates how small a valid domain can be. Don't add unrelated tools here.

### Connectors & Domain Table
- Connectors are DECLARED in `config.ts` (`communicationSettings.connectors`), never hand-wired in `agent.ts`. `memory: 'basic'` (title generation only) is the default tier.
- RAG is opt-in: an agent receives `search_knowledge` ONLY when it declares `connectors: { rag: true }` in its `config.ts` — without that key it does not get the tool even though it stays registered in the root Mastra `tools` registry (`src/mastra/index.ts`). `communicationSettings` declares no `rag`, so this agent does not receive it.
- The domain table (agent name, long scope line, sibling descriptions) lives once in `shared/agents/domain-catalog.ts`; `scope.ts` reads `DOMAIN_CATALOG.communication` + `siblingsOf('communication')` — never re-copy sibling strings locally.

### Testing Requirements
- Agent-identity unit test pattern applies if tests are added (`id`, `name`, `model` only — Agent props aren't public). Structural wiring tests reference the three `agent.ts` exports (`communicationAgent`, `communicationScopeGuard`, `communicationSecurityStack`).

## Dependencies

### Internal
- `shared/agents/build-agent.ts` (`buildDomainAgent`), `shared/agents/domain-catalog.ts`, `shared/processors/security-stack.ts`

### External
- `@mastra/core/tools`, `zod` (the `Agent`/memory packages arrive via `shared/agents/build-agent.ts`)

<!-- MANUAL: -->
