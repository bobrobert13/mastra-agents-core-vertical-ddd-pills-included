<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# docs

## Purpose

Human decision record: Architecture Decision Records, per-domain completion docs, and the testing guide.

## Key Files

| File | Description |
|------|-------------|
| `TESTING.md` | The four test tiers (smoke/unit/integration/evals) + real CI job table |
| `PRODUCTION-GAP-ANALYSIS.md` | Audit vs. professional Mastra 1.x deployments: dead config findings (auth/pubsub/env vars), missing core capabilities (Auth, MCP, Vectors/RAG, scheduling, HITL), anti-filler list, phased execution order |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adr/` | `001-vertical-slicing.md`, `002-postgres-vector.md`, `003-event-driven.md` + README index (see `adr/AGENTS.md`) |
| `specs/` | Spec+ production roadmap: `README.md` (index, dependency matrix, frozen ADR/gotcha map) + 8 phase specs, each precision-gated against installed 1.66.0 dist (see each spec's verification table) |
| `domains/` | `RESEARCH-COMPLETION.md` — worked example of domain docs |

## For AI Agents

### Working In This Directory
- **New architectural decision ⇒ new ADR file, never edit accepted ADRs**; supersede them with a new numbered record instead.
- When infra optionality changes (`shared/config/storage.ts`/`observability.ts`/`providers.ts` wired via `infrastructure.ts`), update the affected ADR context section via a new ADR or an `Updated:` line, and keep root `AGENTS.md`'s service table in sync.
- Docs are English (repo language) even though conversation may be Spanish.

<!-- MANUAL: -->
