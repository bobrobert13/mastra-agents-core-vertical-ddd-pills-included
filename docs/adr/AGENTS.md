<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 | Updated: 2026-09-12 -->
# adr

## Purpose

Numbered Architecture Decision Records with status tracking (`Accepted`/`Superseded`). Read these before proposing structural changes — they encode why the boilerplate is shaped the way it is.

## Key Files

| File | Description |
|------|-------------|
| `README.md` | ADR index + numbering convention |
| `001-vertical-slicing.md` | Domains as self-contained vertical slices; no cross-domain imports |
| `002-postgres-vector.md` | PostgreSQL + pgvector chosen day one for future RAG (note: storage is now env-optional with LibSQL fallback) |
| `003-event-driven.md` | Cross-domain communication via shared typed event bus |

## For AI Agents

### Working In This Directory
- Append-only: new decision = next number; to reverse one, write a new ADR that marks the old as Superseded and links it.

<!-- MANUAL: -->
