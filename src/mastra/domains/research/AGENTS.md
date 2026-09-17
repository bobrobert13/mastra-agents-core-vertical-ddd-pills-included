<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-17 -->
# research

## Purpose

Web-research vertical slice: an agent that searches the web, fetches pages, summarizes them, plus a `deep-research` workflow (`search-sources` → `fetch-content` → `summarize-content` → HITL `review-findings`) and a heuristic relevance scorer. Reference implementation for provider-agnostic custom tools and for the declarative connector pattern (RAG opt-in, MCP-routed).

## Key Files

| File | Description |
|------|-------------|
| `agent.ts` | Composition root (~20 LOC): `buildDomainAgent({ scope, instructionsBody, tools: { web_search, web_fetch, summarize }, ...researchSettings })`. Fixes the three structural-test exports: `researchAgent`, `researchScopeGuard`, `researchSecurityStack` |
| `scope.ts` | `researchScope` (`DomainScope`): `agentName`/`scope`/`siblings` are read from `shared/agents/domain-catalog.ts` (`DOMAIN_CATALOG.research` + `siblingsOf('research')`); only `outOfScopeExamples` and `refusal: { tone: 'warm' }` are local |
| `config.ts` | Domain knobs: `researchSettings` (`modelKey: 'research'`, `maxSteps: 50`, `connectors: { memory: 'observational', mcp: 'research' }`) + `deepResearchSettings.summaryMaxLength = 300` |
| `instructions.ts` | `researchInstructions` — capability body; `scopedInstructions()` prepends the scope/refusal block |
| `events.ts` | `research.started` / `research.completed` contract types — declared only, this slice has no publisher for them yet |
| `types.ts` | Domain types shared by tools/workflows |
| `index.ts` | Barrel — the only import surface: scope, config (both settings objects), instructions, agent + guard + security stack, tools, workflow, scorer, types, events |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `tools/` | `web-search.ts` (custom DuckDuckGo HTML scraping — replaces built-in `webSearchTool`, which only supports OpenAI/Anthropic/Google/xAI), `web-fetch.ts` (URL content extraction + injection scan), `summarize.ts` (LLM summarization with maxLength truncation), `index.ts` barrel |
| `workflows/` | `deep-research.ts` (composition only, ~27 LOC; re-exports `reviewFindingsStep` so existing consumers keep resolving it from this path), `schemas.ts` (shared inter-step Zod — one declaration per shape), `steps/{search,fetch,summarize,review}.ts` (one step per module; ids `search-sources` → `fetch-content` → `summarize-content` → `review-findings`, the last carrying the suspend/resume HITL point); **registered** in `src/mastra/index.ts` `workflows` map (visible at `GET /api/workflows`) |
| `scorers/` | `relevance-scorer.ts`: heuristic score (0-1) + reason; used by `tests/evals/research.eval.test.ts` |

## For AI Agents

### Working In This Directory
- `web-search.ts` is the canonical pattern for **replacing any built-in Mastra tool unsupported by the current provider** — parse-free, key-free DuckDuckGo; keep failure mode non-throwing (returns `{ results: [] }`).
- Summarizer output MUST be truncated to `maxLength` (`substring(0, maxLength-3) + '...'`) — an eval asserts this. The limit comes from `deepResearchSettings.summaryMaxLength`, never a literal inside a step.
- New tools: create in `tools/`, export from `tools/index.ts`, add a unit test under `tests/unit/domains/research/tools/`.

### Connectors & Domain Table
- Connectors are DECLARED in `config.ts` (`researchSettings.connectors`), never hand-wired in `agent.ts`. `memory: 'observational'` replaces the retired `enableObservationalMemory` flag; `mcp: 'research'` is the `MCP_SERVERS` routing key (`agents: [...]`) — no key ⇒ no discovery, no subprocess.
- RAG is opt-in: an agent receives `search_knowledge` ONLY when it declares `connectors: { rag: true }` in its `config.ts` — without that key it does not get the tool even though it stays registered in the root Mastra `tools` registry (`src/mastra/index.ts`). `researchSettings` declares no `rag`, so this agent does not receive it.
- The domain table (agent name, long scope line, sibling descriptions) lives once in `shared/agents/domain-catalog.ts`; `scope.ts` reads `DOMAIN_CATALOG.research` + `siblingsOf('research')` — never re-copy sibling strings locally.

### Testing Requirements
- Unit: `tests/unit/domains/research/` (agent identity + summarize/web-search tools). Structural wiring tests reference the three `agent.ts` exports (`researchAgent`, `researchScopeGuard`, `researchSecurityStack`).
- Evals: `tests/evals/research.eval.test.ts` (LLM calls — needs a provider API key).

## Dependencies

### Internal
- `shared/agents/build-agent.ts` (`buildDomainAgent`), `shared/agents/domain-catalog.ts`, `shared/processors/security-stack.ts`, `shared/logger.ts`, `shared/events/event-bus.ts`, `shared/tools/run-tool.ts`

### External
- `@mastra/core/tools`, `@mastra/core/agent` (`TripWire`), `@mastra/core/workflows`, `zod`

<!-- MANUAL: -->
