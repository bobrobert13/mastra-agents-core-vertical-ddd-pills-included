<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# research

## Purpose

Web-research vertical slice: an agent that searches the web, fetches pages, summarizes them, plus a 3-step `deep-research` workflow and a heuristic relevance scorer. Reference implementation for provider-agnostic custom tools.

## Key Files

| File | Description |
|------|-------------|
| `agent.ts` | `research-agent` / "Research Agent"; model via `agentModel.research()` — env-driven, provider-agnostic; Memory + observationalMemory via `memoryModel()` |
| `events.ts` | `research.started` / `research.completed` event contracts (published on the shared bus) |
| `types.ts` | Domain types shared by tools/workflows |
| `index.ts` | Barrel — the only import surface for other code |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `tools/` | `web-search.ts` (custom DuckDuckGo HTML scraping — replaces built-in `webSearchTool`, which only supports OpenAI/Anthropic/Google/xAI), `web-fetch.ts` (URL content extraction), `summarize.ts` (LLM summarization with maxLength truncation), `index.ts` barrel |
| `workflows/` | `deep-research.ts`: `search-sources` → `fetch-content` → `summarize-content` |
| `scorers/` | `relevance-scorer.ts`: heuristic score (0-1) + reason; used by `tests/evals/research.eval.test.ts` |

## For AI Agents

### Working In This Directory
- `web-search.ts` is the canonical pattern for **replacing any built-in Mastra tool unsupported by the current provider** — parse-free, key-free DuckDuckGo; keep failure mode non-throwing (returns `{ results: [] }`).
- Summarizer output MUST be truncated to `maxLength` (`substring(0, maxLength-3) + '...'`) — an eval asserts this.
- New tools: create in `tools/`, export from `tools/index.ts`, add a unit test under `tests/unit/domains/research/tools/`.

### Testing Requirements
- Unit: `tests/unit/domains/research/` (agent identity + summarize/web-search tools).
- Evals: `tests/evals/research.eval.test.ts` (LLM calls — needs a provider API key).

## Dependencies

### Internal
- `shared/logger.ts`, `shared/events/event-bus.ts`

### External
- `@mastra/core/agent`, `@mastra/core/tools`, `@mastra/core/workflows`, `@mastra/memory`, `zod`

<!-- MANUAL: -->
