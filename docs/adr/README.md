# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Mastra Boilerplate project.

## What is an ADR?

An Architecture Decision Record (ADR) captures a single architectural decision made in a project, including the context, options considered, and the decision made.

## ADRs

- [ADR-001: Vertical Slicing Architecture](./001-vertical-slicing.md)
- [ADR-002: PostgreSQL with pgvector](./002-postgres-vector.md)
- [ADR-003: Event-Driven Cross-Domain Communication](./003-event-driven.md) — **Superseded by ADR-005**
- [ADR-004: Server & Studio Authentication](./004-auth-server-studio.md) — env-optional JWT, production fail-fast
- [ADR-005: Cross-Process Eventing (env-optional Redis bridge)](./005-cross-process-eventing.md) — ack-on-every-delivery, at-least-once, no DLQ
- [ADR-006: Vectors, Embedders & the Degrade Contract](./006-vectors-embeddings.md) — local-first E5 embedder, vector store mirrors storage, never-crash off-banner (extends ADR-002)
- [ADR-007: MCP as the Single External-Integration Boundary](./007-mcp-as-integration-boundary.md) — inbound `MCPClient` singleton from `MCP_SERVERS` JSON + approval floor; opt-in read-only outbound `MCPServer` (composition-layer carve-out); stdio esbuild artifact
- [ADR-008: Application Data in Mastra Storage Databases](./008-application-data-in-mastra-storage.md) — custom tables (`app_tasks`), domain-owned repositories, `AppDatabase` factory
- [ADR-009: Deterministic Security Processors as the Default Pipeline](./009-guardrails-security-processor-pipeline.md) — guardrails stack (inert-without-key rule) + workspace jail + HITL approvals/suspensions
- [ADR-010: Eval Datasets & Experiments Live in Mastra Storage](./010-eval-datasets-experiments-in-storage.md) — `mastra.datasets` storage domains at runtime, git JSON stays the reviewed seed source, 90d retention on experiments+scores (datasets deliberately excluded)

## Template

Use this template for new ADRs:

```markdown
# ADR-XXX: Title

## Status
Accepted | Proposed | Deprecated | Superseded

## Context
What is the issue that we're seeing that is motivating this decision?

## Options Considered
What are the different options we considered?

### Option 1: Name
- Pros: ...
- Cons: ...

### Option 2: Name
- Pros: ...
- Cons: ...

## Decision
What is the change that we're proposing and/or doing?

## Consequences
What becomes easier or more difficult to do because of this change?
```
