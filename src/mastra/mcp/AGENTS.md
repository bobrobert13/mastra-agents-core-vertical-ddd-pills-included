<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-15 (spec 04) -->
# mcp

## Purpose

Composition-layer assembly of the project's OWN exposed MCP server (spec 04). This is the sanctioned carve-out of the "optional services live in `shared/config/<service>.ts`" rule: building an `MCPServer` requires importing domain barrels, and `shared/` may never import `domains/` — so this module sits at composition level like `index.ts` itself.

## Key Files

| File | Description |
|------|-------------|
| `server.ts` | `buildMcpServer(services?)` — `ENABLE_MCP_SERVER=true` ONLY (off by default); exposes exactly the read-only primitives (`agents: research, comms` + `tools: file-read`; canonical banner strings exported as constants). Also `createReadonlyMcpServer()` for the stdio entry |
| `stdio.ts` | Shebang standalone entry (`await mcpServer.startStdio()`, no HTTP server) — runs via the esbuild bundle `.mastra/mcp-stdio.mjs` (`npm run mcp:stdio`), NOT under plain Node (extensionless imports) |

## For AI Agents

- **Never add mutating primitives here.** Write/edit/create tools must not join the exposed surface without a HITL approval story (Spec 06). The static list is unit-asserted zero-mutating.
- The inbound side (`MCPClient`, env JSON) is NOT here — it lives in `shared/config/mcp.ts` + `mcp-parse.ts` and obeys the normal shared-service rule.
- `index.ts` may contain exactly one awaited call to `buildMcpServer()`; keep it that way.
- stdio mode boots without HTTP banner/observability wiring — minimal subset by design (spec 04 Phase 4 sweep note); see ADR-007.

<!-- MANUAL: -->
