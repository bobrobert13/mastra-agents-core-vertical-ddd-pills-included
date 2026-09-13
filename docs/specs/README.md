# Specs — Production Roadmap (Phase 1–8)

> Spec+ feature specifications derived from [`docs/PRODUCTION-GAP-ANALYSIS.md`](../PRODUCTION-GAP-ANALYSIS.md),
> approved for phased execution. One spec per phase; each is self-contained, decision-complete,
> and ready for implementation on your go-ahead. Every spec's DoD includes the project-documentation
> sync it owes (root/`src`/`shared`/`tests` AGENTS.md tables + gotchas, `.env.example`, README,
> `docs/TESTING.md`, new ADR where warranted) — docs are updated **with** the code, never after.

## Index & status

| # | Phase | Spec | Lines | Scenarios | Est. impact | Gate history | Status |
|---|-------|------|-------|-----------|-------------|--------------|--------|
| 01 | 1 | [auth-server-studio](01-auth-server-studio.md) | 229 | 5 | ~350–400 LOC / 11 files | 0B/6M → fixed | ✅ **implemented** `d78c8ff` |
| 02 | 2 | [distributed-pubsub-workers](02-distributed-pubsub-workers.md) | 317 | 5 | ~615 LOC / 18 files | 3B/8M → fixed → re-gate PASS | ✅ **implemented** `60b9d48` |
| 03 | 3 | [vectors-rag-semantic-recall](03-vectors-rag-semantic-recall.md) | 649 | 8 | ~1,350–1,650 LOC / ~26 files | 1B/+9M → fixed → re-gate PASS | ✅ **implemented** `b9edb8f` |
| 04 | 4 | [mcp-connections](04-mcp-connections.md) | 536 | 4 | ~730–800 LOC / 18 files | 2B/8M → fixed → re-gate PASS | ✅ **implemented** `40aa8ae` |
| 05 | 5 | [task-persistence-and-schedules](05-task-persistence-and-schedules.md) | 404 | 5 | ~1,300–1,600 LOC / ~20 files | 0B/8M → fixed | ✅ **implemented** `2cd9764` |
| 06 | 6 | [guardrails-and-hitl](06-guardrails-and-hitl.md) | 325 | 6 | ~950–1,250 LOC / ~30 files | 0B/9M → fixed | ✅ **implemented** `44e16e7` |
| 07 | 7 | [evals-ci-quality-gates](07-evals-ci-quality-gates.md) | 278 | 5 | ~950+250 LOC / ~18 files | 1B/8M → fixed (+2 carry-forward) | ✅ **implemented** `8f29ba8` |
| 08 | 8 | [custom-routes-streaming-otlp](08-custom-routes-streaming-otlp.md) | 392 | 5 | ~875 LOC / ~26 files | 0B/6M → fixed | ✅ **implemented** `859d567` |

B/M = blockers/minors found by the **independent** precision gate (drafts were also
self-gated by their authors first). Total: **7 blockers caught and fixed before implementation**
— incl. a boot-killing stdio runner, a `getTool` throw that would crash every degrade path, a
Redis PEL backlog from missing acks, and a compose healthcheck that could never pass on alpine.
Estimates are the specs' own, grounded via codegraph + `wc -l` — re-verify against the post-phase
tree before starting each implementation.

## Dependency matrix (execution order = phase numbers)

```
01 auth ─────┬─► 02 pubsub/workers ──► 05 persistence/schedules (scheduler worker)
             │                        └► 08 routes (cross-process webhook delivery)
             └─► 04 MCP (Studio/HTTP exposure needs auth)
03 vectors/RAG ── (recommended before) ──► 07 evals (context*/faithfulness scorers)
06 guardrails ◄── co-designed with 04 (MCP approval feeds 06's single approval flow)
07 evals/CI ── consumes gates of everything above; carries forward 02's ci.yml additions
```

Hard edges: 01 before any production deploy; 02 before 05's schedules in split topology;
07 must not revert 02's build/CI changes (carry-forward rule in 07 §3.4).

## Frozen cross-spec numbering

**ADRs** (append-only; never edit accepted ADRs 001–003; canonical map in spec 04 §3.9):

| ADR | Topic | Owning spec |
|-----|-------|-------------|
| 004 | Server & Studio auth | 01 |
| 005 | Cross-process eventing — **supersedes ADR-003** | 02 |
| 006 | Vectors & embeddings — extends ADR-002 via `Updated:` line | 03 |
| 007 | MCP as integration boundary | 04 |
| 008 | Application data in Mastra storage (AppDatabase) | 05 |
| 009 | Guardrails security-processor pipeline | 06 |
| 010 | Eval datasets & experiments in production storage | 07 |
| —   | (feature-level, no ADR) | 08 |

**Root AGENTS.md gotchas** (merge by phase order): 01→#9, 02→#10, 04→#11, 05→#12;
03/06/07/08 claim "next free at merge time" — recompute if execution order changes.

## Settled decisions baked into the set

- **D1** 8 specs, one per phase (this index).
- **D2** Auth: dev boots unauthenticated with a loud banner; `NODE_ENV=production` without auth **refuses to boot** (escape hatch `AUTH_DISABLED=true`). Worker containers receive `MASTRA_JWT_SECRET` via 02's `x-mastra-env`.
- **D3** Embeddings: `EMBEDDING_MODEL` → ModelRouter; unset → `@mastra/fastembed` local multilingual E5 (zero-config recall stays possible); embedder→index dimension stickiness is a documented gotcha.
- **D4** CI: typecheck + coverage (floor 74/70/55, ratchet policy, `include: ['src/**/*.ts']` fix) + eval gates all **blocking**; two-tier evals (keyless Tier A always; LLM-judge Tier B on live/nightly with secrets — never false-red on forks).
- HITL split: **06** owns all approval mechanics (tool-call-approval surface, workflow suspend/resume, jail); **04** owns only the MCP per-server approval predicate feeding that flow.
- Redis scope: **02** ships pubsub + `REDIS_URL` convention only — RedisCache and Redis-backed rate limiting are explicitly **out** (unassigned follow-ups riding the convention).

## How to use

1. Confirm a phase → implement on `feat/<spec-slug>` per its DoD (commit-size guardrails inside).
2. Its DoD doc-sync checkboxes are the contract for "documentation updated after changes".
3. Re-run the full gate (`lint`, `tsc --noEmit`, `test:all`, `build`, dev boot) before merge, per root AGENTS.md.
4. Numbering: if execution order shifts, apply the phase-order renumber note in each spec (only filenames/index lines move; decision text never does).
