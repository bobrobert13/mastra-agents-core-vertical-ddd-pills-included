# ADR-007: MCP as the Single External-Integration Boundary (spec 04)

## Status

Accepted

## Context

Before this spec, every external capability was hand-written: each third-party connector was a custom `createTool()` (~66 LOC/tool, e.g. `domains/research/tools/web-search.ts`), and nothing of the boilerplate was consumable from outside except raw HTTP. Meanwhile the team's editors and Claude Desktop speak MCP natively, and the vendor ecosystem ships MCP servers for wikis, CRMs and issue trackers.

Two asymmetries forced a decision:

1. **Inbound trust:** MCP tool *descriptions* and *results* are attacker-influenceable model input. The scope guard (`createScopeGuard`) classifies user text only — it never inspects tool I/O (spec 04 §3.5). Spec 06's `PromptInjectionDetector` is the designated output sanitizer; until it ships, MCP is a **dev-local trust boundary**.
2. **Outbound capability:** the file-operations and task-management domains carry write/edit/create/update tools; exposing them unguarded to whoever reaches port 4111 repeats the gotcha #7 lesson (root `AGENTS.md`). Auth (ADR-004, Spec 01) now gates `/api/*` + Studio, and registered MCP servers inherit `server.auth` — but the exposed surface must still be minimal.

Structural constraint: `shared/` may never import `domains/` (ADR-001 discipline, `shared/AGENTS.md`), yet building an `MCPServer` requires the domain agent instances. And `MCPClient` instances are per-config memoized in the SDK **only when no explicit `id` is given** — with an `id`, duplicate configs are *allowed*, which would mask a double-spawned stdio subprocess if each entry point constructed its own client.

## Decision

**MCP is the single external-integration boundary for this boilerplate.** In: `MCPClient` fed from the `MCP_SERVERS` env JSON, static toolsets at boot. Out: a read-only `MCPServer`, opt-in. Hand-written per-vendor connectors remain domain code **only for primitives with no MCP equivalent** (anti-filler rule, gap analysis §4).

### 1. Inbound (`shared/config/mcp.ts` + `mcp-parse.ts`)

- Parsing/validation is a **pure Zod module** (`mcp-parse.ts`, zero runtime deps — never imports `@mastra/mcp`): unset ⇒ `{}` (golden rule), set-but-invalid ⇒ fail-fast boot error with the exact Scenario-2 message family (`[MCP] Invalid MCP_SERVERS …`). `${VAR}` interpolation for `env`/`requestInit.headers`; unknown `VAR` is a boot error. Transport-exclusive keys, absolute-http(s) `url`, and the reserved server key `boilerplate` are all schema-enforced; the `agents` routing key is builder-owned and **stripped before reaching `MCPClient.servers`**.
- **One client, one memoization (ESM-ordering trap):** a domain module's top-level await runs *before* `index.ts`'s body; if `buildMcpClient` and `loadMcpToolsFor` each constructed a client, one stdio server would spawn **twice** — and the explicit `id: 'boilerplate-mcp-client'` would hide it (the duplicate-config throw exists only *without* an id). So `mcp.ts` owns the sole module-level memoized `MCPClient`; `buildMcpClient()` only re-gets it to report banner status; the integration test asserts **exactly one spawned child process** and instance identity.
- Discovery uses `listToolsWithErrors({ perServerTimeoutMs: 3000 })`: a down server degrades to a warn line + excluded tools; it never crashes boot.

### 2. Approval floor

Every server without an explicit `requireToolApproval` gets `defaultMcpApprovalPolicy`: tool names matching `(?:^|[_\-.])(?:write|edit|delete|remove|drop|create|update)(?:[_\-.]|$)` after `toSnake()` camelCase normalization require human approval (Scenario 3). This is a **floor, not a ceiling** — semantically-mutating names that dodge the verb list (`purge_all`, `wipe_bucket`, `transfer_funds`) are not name-detectable; untrusted servers must set `"requireToolApproval": true` wholesale. MCP `annotations` (readOnlyHint/destructiveHint) are deliberately never used to relax approval (spec says clients MUST treat them as untrusted). An explicit `false` is legal but the banner appends `"<name>: approval OFF — every tool runs unattended"` — a visible smell, never silent.

**Serialization constraint (recorded here per spec 04 §3.2):** the *function* form of `requireToolApproval` exists only on regular `stream()`/`generate()` calls. Durable agents and stored agents persist their options, and a function cannot serialize — those contexts accept **boolean only** (a function there degrades to approval for *every* tool call). Irrelevant until `recovery.durableAgents` (gap §2.8) is opted in; this ADR is the place that future opt-in must check.

### 3. Composition-layer carve-out (rule exception)

`src/mastra/AGENTS.md` says new optional services go in `shared/config/<service>.ts`, never inline in `index.ts`. The MCP **client** obeys this. The MCP **server** cannot: `src/mastra/mcp/server.ts` imports domain barrels (research + comms agents, `readFileTool`), and no repo rule restricts who may import a domain's `index.ts` (the bans are sibling→sibling and shared→domains). Hence `mcp/` is a composition-layer directory like `index.ts` itself, `index.ts` gains exactly one awaited `buildMcpServer(services)` call, and `src/mastra/mcp/AGENTS.md` documents the carve-out. The exposed surface is static and non-mutating by construction: `agents: { research, comms }` (both carry descriptions — required, or `MCPServer` throws) + `tools: { 'file-read' }`, the latter flagged in docs for path exposure; workflows are excluded (`deep-research` has no description). Key `boilerplate` is reserved; `MCP_SERVERS` entries using it are rejected.

Out: `ENABLE_MCP_SERVER=true` registers it at `/api/mcp/boilerplate/mcp` (inherits `server.auth` since ADR-004) plus Studio proxies for external servers via `toMCPServerProxies()` — gated on `(mcpServer || mcpClient)` so external servers surface in Studio even with the local server off.

### 4. Stdio artifact

`src/mastra/mcp/stdio.ts` serves the same read-only surface over stdio (`startStdio()`, no HTTP server). It ships as an **esbuild bundle** (`.mastra/mcp-stdio.mjs`, `npm run mcp:stdio`), not as a `--experimental-strip-types` run: Node's ESM resolver rejects this repo's extensionless imports. `--packages=external` keeps native modules out of the bundle. Stdio mode boots without HTTP banner/observability wiring — a minimal subset by design. Claude Desktop block: `{"mcpServers":{"mastra-boilerplate":{"command":"npm","args":["run","mcp:stdio"],"cwd":"/path/to/project"}}}` (documented verbatim in README).

## Consequences

- Adding an external integration = one `MCP_SERVERS` JSON entry + `"agents":["<key>"]` routing, zero new tool code.
- Stdio server config without `"inheritDefaultEnv": false` earns a banner warn (subprocess env leakage, R3); URL servers with `requestInit.headers` earn a log warn (SSE fallback drops custom headers — steer to `allowedHosts` + wholesale approval).
- `forwardInstructions` defaults to `false` and warns when enabled.
- MCP tools bypass the scope guard (input-text classifier); `scopedInstructions()` bodies gain a sentence confining external tools to the agent's scope — instruction-discouraged, not enforced (residual risk, spec 04 R1/R2).
- `npm run mcp:stdio:build` must run before `mcp:stdio` (documented script chain); output lands in gitignored `.mastra/`.
- Durable-agents opt-in (ADR-004/gap §2.8 territory) changes approval semantics to boolean — see §2 serialization constraint.

## References

- Spec: `docs/specs/04-mcp-connections.md` · `src/mastra/shared/config/mcp-parse.ts` · `src/mastra/shared/config/mcp.ts` · `src/mastra/mcp/server.ts` · `src/mastra/mcp/stdio.ts`
- Tests: `tests/unit/shared/config/mcp-parse.test.ts` · `tests/unit/shared/mcp/*.test.ts` · `tests/integration/mcp-stdio.test.ts`
- Upstream docs: https://mastra.ai/docs/connections/mcp · https://mastra.ai/reference/tools/mcp-client · https://mastra.ai/reference/tools/mcp-server
