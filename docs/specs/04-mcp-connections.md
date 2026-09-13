# Spec+: MCP — Consume & Expose (Phase 4)

> **Spec id:** 04 · **Phase:** 4 (execution order per `docs/PRODUCTION-GAP-ANALYSIS.md` §5)
> **Status:** DRAFT
> **Depends on:** Spec 01 (Auth) — required before `ENABLE_MCP_SERVER=true` is safe on any
> non-local deployment: registered MCP servers inherit the `server.auth` principal only when auth
> exists (`node_modules/@mastra/core/dist/mastra/index.d.ts:215` `mcpServers?: TMCPServers`;
> authInfo mapping documented at https://mastra.ai/reference/tools/mcp-server). Until Spec 01 lands,
> the exposed surface is read-only and off by default.
> **Recommended:** Spec 06 (Guardrails + HITL) — MCP tool output is untrusted model input; per the
> cross-spec scan-owner resolution, 06's `PromptInjectionDetector` scans it **on the next model
> call** — mitigated, not closed; same-run tool-output scanning is owned by spec 06 (the
> research-domain `web-fetch` scanning-step pattern, extended to MCP results). The *workflow
> suspend/resume* approval UI also belongs to Spec 06, not here.
> **Boundary:** this spec covers the MCP transport layer only — `MCPClient`, `MCPServer`, and the
> per-server `requireToolApproval` predicate. HITL persistence via `step.suspend()` /
> `run.resume()` (gap analysis §2.6) is Spec 06's scope; MCP is its most important consumer.
> **Out of scope:** `appResources` / MCP Apps (`ui://` interactive HTML resources — documented at
> https://mastra.ai/reference/tools/mcp-server#mcp-apps — explicitly excluded from the boilerplate
> as product-vertical surface, matching the anti-filler rule in gap analysis §4), elicitation
> handlers, OAuth `MCPOAuthClientProvider` flows (listed as open questions only).

All external API claims below were verified against https://mastra.ai/docs/connections/mcp.md,
https://mastra.ai/reference/tools/mcp-client.md and https://mastra.ai/reference/tools/mcp-server.md
on 2026-09-15. `@mastra/mcp` is **not** currently a dependency (`package.json:40-49`); it must be
added with `npm install @mastra/mcp --legacy-peer-deps` (root `AGENTS.md` gotcha #1).

## Phase 1: Strategic Vision

* **Vision:** MCP turns this boilerplate from a closed set of four example domains into a two-way
  integration hub — any third-party tool ecosystem plugs in through one JSON env var, and any
  MCP-compatible client (Claude, IDEs, teammates' agents) consumes the project's own primitives
  without a proprietary SDK.

* **OKR / Goal (PROPOSED — measurable proxy pending D3 confirmation):**
  * **O1:** Adding a new external integration = **one `MCP_SERVERS` JSON entry + zero new custom
    tool code** (today: ~66 LOC per tool, cf. `src/mastra/domains/research/tools/web-search.ts:5-66`).
    Target: 3 different community MCP servers (stdio + HTTP) wired through `MCP_SERVERS` with `src/`
    unchanged.
  * **O2:** The boilerplate is consumable **from Claude Desktop via one `mcpServers` config block**
    (stdio entry runnable as `npm run mcp:stdio` — a bundled standalone artifact, §3.7) and
    **from any IDE via the registered HTTP endpoint**, with
    `ENABLE_MCP_SERVER=true` and zero code changes.
  * **O3:** 100% of inbound MCP tool calls whose name matches a mutating pattern require approval
    by default (measured by the unit predicate matrix, Phase 3/5).

## Phase 2: Functional Spec (BDD)

* **User Story:** As an **integration engineer** cloning this boilerplate for a client project, I
  want to connect third-party data sources (wiki, CRM, issue tracker) to agents via MCP servers and
  to expose the boilerplate's own agents/tools to my editors' MCP clients, so that I can ship
  integrations without hand-writing tool code or a bespoke adapter API.

### Acceptance Criteria

* **Scenario 1: Env JSON parses and the agent receives server tools (happy path)**
  * **Given** `MCP_SERVERS='{"wikipedia":{"command":"npx","args":["-y","wikipedia-mcp"],"agents":["research"]}}'`
    is set and the app boots
  * **When** the `research` agent is constructed
  * **Then** its tool map contains the Wikipedia server's tools keyed with the `wikipedia_<toolName>`
    namespace that `MCPClient.listTools()` applies (verified: https://mastra.ai/reference/tools/mcp-client#listtools)
  * **And** the startup banner prints `✅ MCP client       1 server: wikipedia (stdio)` via the
    standard `ServiceStatus` push pattern (`src/mastra/shared/config/providers.ts:26-33` is the
    reference shape).

* **Scenario 2: Malformed `MCP_SERVERS` JSON fails the boot with an actionable error**
  * **Given** `MCP_SERVERS` is set to a string that is not valid JSON (e.g. `MCP_SERVERS='{wikipedia'`)
  * **When** `npm run dev` imports `src/mastra/index.ts`, whose `buildInfrastructure()` →
    `buildMcpClient()` call throws
  * **Then** the boot fails during module import (non-zero exit of `mastra dev`) with exactly this message shape:
    `[MCP] Invalid MCP_SERVERS: JSON parse failed ("Unexpected end of JSON input"). Expected a JSON object of server definitions keyed by server name, e.g. {"wikipedia":{"command":"npx","args":["-y","wikipedia-mcp"]}}. Unset the variable to disable MCP entirely; see .env.example.`
  * **And** a syntactically valid JSON with a bad entry fails the same way with
    `[MCP] Invalid MCP_SERVERS entry "<name>": exactly one of "command" (stdio) or "url" (HTTP) is required. Unset the variable to disable MCP entirely; see .env.example.`
  * **Rationale (DECIDED):** an *unset* variable must never error (repo golden rule, root
    `AGENTS.md` "How It Works"), but a *set-but-invalid* value is a config bug, and the repo
    philosophy for those is fail-fast with an actionable message — gap analysis §3.4: *"everything
    optional, but whatever is present must be valid"*. Silent degradation to "off" would hide
    misconfiguration in production. An empty string (`MCP_SERVERS=`) counts as unset → off.

* **Scenario 3: An inbound MCP tool matching a mutating pattern is approval-gated**
  * **Given** `MCP_SERVERS` configures a server that exposes a tool named `delete_page` (or
    `write_note`, `edit_record`, `create_issue`…)
  * **And** no explicit `requireToolApproval` key is present for that server in the JSON
  * **When** the agent attempts to call `wikipedia_delete_page`
  * **Then** `MCPClient`'s server-level `requireToolApproval` callback —
    `boolean | ({ toolName, args, requestContext, annotations }) => boolean | Promise<boolean>`
    (verified: https://mastra.ai/reference/tools/mcp-client#constructor, field list) — returns
    `true` via `defaultMcpApprovalPolicy`, so the call suspends for human approval
  * **And** a read-only tool such as `wikipedia_search` does **not** require approval.

* **Scenario 4: `MCPServer` is disabled by default and exposes only non-mutating primitives when enabled**
  * **Given** `ENABLE_MCP_SERVER` is unset (the shipped default)
  * **When** the app boots
  * **Then** no `MCPServer` is registered (`new Mastra` receives no `mcpServers` key for our own
    server), and the banner prints `○ MCP server       disabled — set ENABLE_MCP_SERVER=true (read-only surface; requires Spec 01 auth outside localhost)`.
    (This exact `ServiceStatus.detail` string is canonical — §3.6 and the unit test assert on it verbatim.)
  * **And** with `ENABLE_MCP_SERVER=true` the registered server contains **only** non-mutating
    primitives: `agents: { research, comms }` (both have non-empty `description` — required, or
    `MCPServer` throws at init, verified:
    https://mastra.ai/reference/tools/mcp-server#exposing-agents-as-tools — e.g.
    `src/mastra/domains/research/agent.ts` description line; file-operations and task-management
    agents are **excluded** because they carry `writeFileTool`/`editFileTool`
    (`src/mastra/domains/file-operations/tools/index.ts:1-3`) and `create/update` task tools),
    plus `tools: { readFileTool }` behind documentation that flags path exposure. `deep-research`
    is not exposed in v1 because `deepResearchWorkflow` has no `description`
    (`src/mastra/domains/research/workflows/deep-research.ts:157-168`) and workflow exposure
    throws without one (same doc anchor, "workflows must have a non-empty description").
  * **Why the default is off:** exposing file-operations write/edit tools to whoever reaches port
    4111 without auth/approval would repeat the lesson of root `AGENTS.md` gotcha #7
    (`AGENTS.md:111`) — a capable, unguarded surface does damage; incident response here is a
    *feature*, not a bug.

## Phase 3: Technical Contract & DoD

### 3.1 Environment contract (two new variables, both optional)

```jsonc
// .env.example addition (PROPOSED exact shape; every key validated by Zod in the builder)
// MCP_SERVERS='{"wikipedia":{"command":"npx","args":["-y","wikipedia-mcp"],"agents":["research"]},
//   "weather":{"url":"https://weather.example.com/mcp","requestInit":{"headers":{"Authorization":"Bearer <API_KEY>"}},"allowedHosts":["weather.example.com"]}}'
// ENABLE_MCP_SERVER=false
```

```ts
// src/mastra/shared/config/mcp-parse.ts (pure module) — PROPOSED types (Zod-parsed; validated shape)
export interface McpServerJsonEntry {
  // transport: builder enforces EXACTLY one of command | url (own Zod rule). The MCP docs only
  // describe transport *detection* precedence — command ⇒ Stdio, url ⇒ Streamable-HTTP with SSE
  // fallback (verified: https://mastra.ai/reference/tools/mcp-client#mastramcpserversdefinition) —
  // so ambiguity is resolved here as a config bug, matching Scenario 2's fail-fast stance.
  command?: string;                    // stdio executable
  args?: string[];
  env?: Record<string, string>;        // supports "${VAR}" interpolation from process.env
  inheritDefaultEnv?: boolean;         // JSON default: true (SDK curated whitelist) —
                                       // builder warns unless explicitly false for stdio (Security below)
  url?: string;                        // parsed via new URL(); must be absolute
  requestInit?: { headers?: Record<string, string> }; // "${VAR}" interpolation supported
  allowedHosts?: string[];             // exact host[+port] matching, no wildcards (verified in reference)
  timeout?: number;                    // ms, per server
  requireToolApproval?: boolean;       // override ONLY; unset ⇒ defaultMcpApprovalPolicy applies
  forwardInstructions?: boolean;       // default false; builder logs a warning when true
  agents?: string[];                   // PROPOSED routing key: Mastra agent registry keys that
                                       // receive this server's tools; default [] (wired nowhere).
                                       // Builder-owned: STRIPPED by Zod (transform/pick) before
                                       // the entry is passed to MCPClient.servers — it is NOT a
                                       // MastraMCPServerDefinition field and must never leak.
}

export interface McpEnv {
  MCP_SERVERS?: string;                // JSON: Record<string, McpServerJsonEntry>
  ENABLE_MCP_SERVER?: string;          // 'true' activates the exposed server; anything else = off
}
```

`${VAR}` interpolation is mandatory because JSON env vars cannot carry secrets and `requestInit`
is static at construction; values interpolate from `process.env` at build time and an unknown
`VAR` is a **boot error** with the same message family as Scenario 2.

Zod cross-field rules (every violation = Scenario-2 entry error, same message family):

* **transport-exclusive keys:** `requestInit` / `allowedHosts` are only legal on `url` entries;
  `env` / `inheritDefaultEnv` / `command` / `args` only on stdio entries.
* **reserved server key:** an entry named `boilerplate` is rejected — it collides with this
  project's own exposed `MCPServer` key in the `mcpServers` map (§3.3).
* **SSE fallback warn:** on `url` + `requestInit.headers` entries the builder emits
  `logger.warn` — the reference documents Streamable-HTTP falling back to legacy SSE when the
  initial connection fails, and with SSE `requestInit` alone does NOT attach custom headers (the
  SDK bug requires `eventSourceInit` or a custom `fetch`, neither JSON-expressible), so an
  authenticated remote configured this way can fail or connect unauthenticated after the
  fallback. README steers such servers to `allowedHosts` + `requireToolApproval: true`.

### 3.2 Approval policy (inbound — MCPClient side)

```ts
// src/mastra/shared/config/mcp-parse.ts (pure module — §3.3) — PROPOSED (signature verified:
// requireToolApproval is
// boolean | (params: {toolName, args, requestContext, annotations}) => boolean | Promise<boolean>,
// https://mastra.ai/reference/tools/mcp-client#tool-approval)
const MUTATING_NAME = /(?:^|[_\-.])(?:write|edit|delete|remove|drop|create|update)(?:[_\-.]|$)/i;
// Roots `write|edit|delete` are the settled decision; `remove|drop|create|update` extend the list
// to cover this repo's own mutating verbs — the real strings: createTool ids `task-create` /
// `task-update` (src/mastra/domains/task-management/tools/create-task.ts:5, update-task.ts:5),
// agent tool-map keys `create_task` / `update_task` / `write_file` / `edit_file`
// (task-management/agent.ts:65-69, file-operations/agent.ts:62-66) against ids `file-write` /
// `file-edit`. All four spellings match the regex unchanged.
// camelCase/PascalCase handling: a delimiter-only boundary lets community names like `deleteFile`,
// `createIssue`, `removeItem`, `updateRecord` PASS UNGATED (hump is not a delimiter). So
// normalize humps to delimiters before testing —
const toSnake = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2');

export function defaultMcpApprovalPolicy({ toolName }: { toolName: string }): boolean {
  return MUTATING_NAME.test(toSnake(toolName));
}
```

`toSnake('deleteFile') → 'delete_File'` (matches; `/i` covers the leading word),
`toSnake('wikipedia_delete_page')` unchanged — both raw server names and the
`serverName_toolName` namespaced form that listTools()/listToolsets() produce are covered.
**Residual gap (recorded, see R2/Q3):** name heuristics cannot catch semantically-mutating tools
that dodge the verb list (`purge_all`, `wipe_bucket`, `transfer_funds`) — the predicate is a floor,
not a ceiling; untrusted servers should set `"requireToolApproval": true` wholesale.

**Serialization constraint (record in the MCP ADR):** the function form of `requireToolApproval`
exists only on regular `stream()`/`generate()` calls — durable agents and stored agents persist
their options, a function cannot serialize, so those contexts accept **boolean only** (a function
there falls back to requiring approval for every tool call; verified:
`node_modules/@mastra/core/dist/docs/references/docs-agents-human-in-the-loop.md:111-121`,
https://mastra.ai/docs/agents/human-in-the-loop). Irrelevant for the boilerplate until gap §2.8
(`recovery.durableAgents`) is opted in — but the ADR must state it so that opt-in doesn't
silently change approval semantics.

Per-server policy: `requireToolApproval` is applied to **every** server definition unless the JSON
sets it explicitly. Explicit `false` is legal but makes the banner append `"<name>: approval OFF"`
— a visible smell, never silent. MCP `annotations` (`readOnlyHint`/`destructiveHint`) are
deliberately **not** used to relax approval in v1: the docs state clients MUST treat annotations
as untrusted unless the server is trusted (verified:
https://mastra.ai/reference/tools/mcp-client#tool-approval). The approval *flow* a suspended call
surfaces into is the HITL machinery of Spec 06 — this spec only guarantees the predicate fires.

### 3.3 Builder wiring (env-optional pattern, per `src/mastra/shared/AGENTS.md`)

The env parser + approval policy live in a **runtime-dependency-free module** so the unit tier
never loads `@mastra/mcp` (shared/AGENTS.md's "one reason to change" rule supports the split):

```ts
// src/mastra/shared/config/mcp-parse.ts — PURE module (no @mastra/mcp import at all):
export function parseMcpServers(raw: string | undefined):
  Record<string, McpServerJsonEntry>;            // Zod-validate here; throws the exact
                                                 // Scenario-2 errors (unit-testable)
export function defaultMcpApprovalPolicy(ctx): boolean;  // §3.2

// src/mastra/shared/config/mcp.ts — owns EXACTLY ONE module-level memoized MCPClient
// singleton (imports MCPClient + mcp-parse). No other module constructs an MCPClient.
export function buildMcpClient(
  services: ServiceRegistry                       // src/mastra/shared/config/service-status.ts:11
): { client?: MCPClient };                        // create-or-get the singleton, then push status
                                                  // in BOTH branches ("MCP client")
export async function loadMcpToolsFor(agentKey: string): Promise<Record<string, Tool>>;
                                                 // consumes the SAME singleton via an internal
                                                 // getMcpClient() (lazy parse+construct, memoized);
                                                 // listToolsWithErrors({ perServerTimeoutMs: 3_000 })
                                                 // + per-server `agents` filter; failed servers land
                                                 // in banner detail, not in a crash
```

* `buildMcpClient` instantiates `new MCPClient({ id: 'boilerplate-mcp-client', servers })` — the
  explicit `id` matters: duplicate identical configs without an id **throw** (memory-leak guard,
  verified: https://mastra.ai/reference/tools/mcp-client#instance-management).
* **Hard rule — one client, one memoization (ESM ordering trap):** a domain module's top-level
  await (`loadMcpToolsFor` in `research/agent.ts`) evaluates **before** the `index.ts` body runs
  `buildInfrastructure()`. If `buildMcpClient` and `loadMcpToolsFor` each constructed a client, a
  configured stdio server would spawn **twice** — and the explicit `id` above would actively mask
  it, because the duplicate-config throw only exists *without* an id. Hence: `getMcpClient()`
  memoizes at `mcp.ts` module scope; `buildMcpClient(services)` only re-gets the memoized
  instance to report banner status; unit test asserts
  `buildMcpClient === loadMcpToolsFor`-observed instance (single subprocess for one stdio entry).
* **Rule carve-out (must be written into the MCP ADR (§3.9, ADR-007) and `src/mastra/AGENTS.md`):** `src/mastra/AGENTS.md:26`
  says "new optional services go in `shared/config/<service>.ts` … never inline" in `index.ts`. The
  MCP **client** obeys this; the **server** cannot, because building `MCPServer` requires importing
  domain barrels and "Nothing in `shared/` may import from `domains/`" (`src/mastra/shared/AGENTS.md`).
  Hence the read-only server assembly lives at composition level in `src/mastra/mcp/server.ts`
  (a composition-layer module like `index.ts` itself; no repo rule restricts who may import a
  domain's `index.ts` barrel — the bans are sibling→sibling and shared→domains) and `index.ts`
  gains exactly one awaited call to it. `src/mastra/AGENTS.md`'s Subdirectories table must add the
  `mcp/` row describing this exception.
* `loadMcpToolsFor` uses `listToolsWithErrors({ perServerTimeoutMs: 3000 })` (verified method,
  https://mastra.ai/reference/tools/mcp-client#listtoolswitherrors) so one dead server degrades to
  a warn line — matching web-search.ts's non-throwing philosophy — while malformed *config* still
  hard-fails (Scenario 2).
* `infrastructure.ts` gains one call (`buildMcpClient(services)`) and returns `mcpClient?` on the
  `Infrastructure` interface (`src/mastra/shared/config/infrastructure.ts:10-14,22-31`; the file
  stays ≤ ~40 lines per `shared/AGENTS.md`).
* **Per-agent injection happens in the domain**, honoring "domains never import siblings" and
  "shared never imports domains": `src/mastra/domains/research/agent.ts` uses
  `tools: { ...local, ...(await loadMcpToolsFor('research')) }` (top-level await — legal here:
  `"type": "module"` at `package.json:5` + `target/module: ES2022` at `tsconfig.json:2-4`,
  esbuild handles TLA; no `MCP_SERVERS`
  ⇒ the call resolves `{}` in ~0 ms, keeping the zero-config tool map byte-identical).
* **`src/mastra/index.ts` composition (PROPOSED diff):**

```ts
const { storage, observability, mcpClient, services } = buildInfrastructure();
const { mcpServer } = await buildMcpServer();              // src/mastra/mcp/server.ts; undefined
                                                           // unless ENABLE_MCP_SERVER=true
export const mastra = new Mastra({
  agents: { /* unchanged, src/mastra/index.ts:16-21 */ },
  workflows: { /* unchanged */ },
  storage,
  ...(observability && { observability }),
  // proxies gate on mcpClient, NOT on mcpServer: shipped defaults (ENABLE_MCP_SERVER unset)
  // + MCP_SERVERS set must still surface external servers in Studio (§3.3 promise):
  ...((mcpServer || mcpClient) && {
    mcpServers: {
      ...(mcpServer && { boilerplate: mcpServer }),
      ...(await mcpClient?.toMCPServerProxies() ?? {}),
    },
  }),
  server: { /* unchanged, src/mastra/index.ts:27-30 */ },
});
logServiceAvailability(services);
```

  `toMCPServerProxies()` (verified: https://mastra.ai/reference/tools/mcp-client#tomcpserverproxies)
  registers *external* clients' servers as Studio-visible proxies — the one-line way "my MCP
  servers show up in Studio"; the key `boilerplate` is reserved for the local server (§3.1
  rejects an `MCP_SERVERS` entry using it). `mcpServers?: TMCPServers` is confirmed in the installed core at
  `node_modules/@mastra/core/dist/mastra/index.d.ts:215`; registered servers are served over HTTP
  at `/api/mcp/<key>/mcp` (path pattern shown in
  https://mastra.ai/reference/tools/mcp-client#progress) and inherit `server.auth` when Spec 01
  lands.

### 3.4 Static vs runtime toolsets (DECIDED for v1)

* **v1 = static only:** `listTools()` at boot, namespaced `serverName_toolName`, injected into
  `Agent` constructors. Rationale: matches this repo's declarative, banner-driven composition; the
  per-request `listToolsets()` path (`serverName.toolName` keys, passed as `toolsets` to
  `generate()`/`stream()` — verified https://mastra.ai/docs/connections/mcp.md#static-and-runtime-tools)
  needs per-user credentials, which need `requestContext` plumbing (gap analysis §2.4) and Spec 01
  auth → recorded as Open Question Q1, not implemented here.
* Stdio hardening: builder emits a `logger.warn` for any stdio server without
  `"inheritDefaultEnv": false`; docs recommend it whenever `env` carries secrets (verified:
  https://mastra.ai/docs/connections/mcp.md#security — POSIX whitelist is `HOME, LOGNAME, PATH,
  SHELL, TERM, USER`; API keys are not inherited by default, `false` narrows to exactly `env`).

### 3.5 Scope-guard interaction (risk documented, per hard rule at `src/mastra/domains/AGENTS.md`)

MCP tools entering an agent are **not** governed by `createScopeGuard()` — that processor
classifies the user's *input text* before the model runs (`src/mastra/shared/processors/scope-guard.ts`,
root `AGENTS.md:111`); it never inspects tool *descriptions* or *results*. Consequences that MUST
be implemented and documented:
* MCP-provided tool descriptions are attacker-influenceable model input ("tool poisoning"); v1
  mitigates with `defaultMcpApprovalPolicy` + `forwardInstructions: false` (default, verified) +
  Spec 06's `PromptInjectionDetector` over tool output (**forward pointer — dependency noted,
  nothing built here**).
* `scopedInstructions()` must gain a sentence (one-line change in the domain bodies): external MCP
  tools may only be used for this agent's scope — the guard can't enforce it, the instruction can
  discourage it. Residual risk stays in Phase 4 R1/R2.

### 3.6 Banner lines (both services, both branches)

```text
○ MCP client       off — set MCP_SERVERS to connect external servers (see .env.example)
✅ MCP client       2 servers: wikipedia (stdio), weather (https://weather.example.com/mcp)
                    [warn] wikipedia: no inheritDefaultEnv:false — stdio env not isolated
                    [warn] weather: approval OFF — every tool runs unattended
○ MCP server       disabled — set ENABLE_MCP_SERVER=true (read-only surface; requires Spec 01 auth outside localhost)
✅ MCP server       "boilerplate" at /api/mcp/boilerplate/mcp + stdio `npm run mcp:stdio` → .mastra/mcp-stdio.mjs (agents: research, comms; tools: file-read)
```

### 3.7 Stdio entry for Claude Desktop (O2)

`src/mastra/mcp/stdio.ts` (shebang, ~25 LOC): builds the same read-only surface and calls
`await mcpServer.startStdio()` (verified method:
https://mastra.ai/reference/tools/mcp-server#startstdio) without booting the HTTP server.

**It cannot run directly under plain Node (verified against this environment, Node 22):**
Node's ESM resolver rejects extensionless specifiers, and every repo import is extensionless
(`./server`, `../domains/research`, …) — `node --experimental-strip-types src/mastra/mcp/stdio.ts`
fails with `ERR_MODULE_NOT_FOUND`. So the shipped mechanism is a **bundled standalone artifact**:

- `"mcp:stdio:build": "esbuild src/mastra/mcp/stdio.ts --bundle --packages=external --platform=node --format=esm --target=es2022 --outfile=.mastra/mcp-stdio.mjs"`
- `"mcp:stdio": "npm run mcp:stdio:build && node .mastra/mcp-stdio.mjs"`

`esbuild` is already present in `node_modules` as a transitive dep of the `mastra` CLI
(`package.json:47`); `--packages=external` keeps it (and native modules like LibSQL) out of the
bundle, and `--format=esm` preserves the top-level awaits. If the transitive dependency proves too
fragile across clones, the fallback is adding `tsx` as a devDependency — decide at implementation;
either way the "zero new deps" claim is dropped. Output lands in `.mastra/` (already gitignored).
The published-package `bin` shape remains Open Question Q2 (the official "Publish a stdio server
package" walkthrough lives at
https://mastra.ai/docs/connections/mcp#publish-a-stdio-server-package).
Claude Desktop block (documented verbatim in README):
`{"mcpServers":{"mastra-boilerplate":{"command":"npm","args":["run","mcp:stdio"],"cwd":"/path/to/project"}}}`.

### 3.8 Estimated Impact (estimate — grounded in existing module sizes, `wc -l` on `shared/config/*`: 24–85 LOC each)

~730–800 LOC across ~18 files:

| Area | Files | ~LOC |
|---|---|---|
| `src/mastra/shared/config/mcp-parse.ts` (pure parser + policy) and `mcp.ts` (client builder) | 2 | 170 |
| `src/mastra/mcp/server.ts`, `src/mastra/mcp/stdio.ts` (new composition layer + AGENTS.md) | 3 | 120 |
| `infrastructure.ts`, `index.ts`, `research/agent.ts` modifications | 3 | +45 |
| `package.json`, `.env.example` | 2 | +20 |
| Tests (unit parser+policy, integration stdio echo, smoke additions, echo-server helper) | 4 | 280 |
| Docs: README section, MCP ADR (`007-mcp-as-integration-boundary.md`, see §3.9 numbering note), root + shared + tests AGENTS.md rows | 4 | 150 |

### 3.9 Definition of Done

- [ ] All four acceptance scenarios covered by tests:
  - [ ] `tests/unit/shared/config/mcp-parse.test.ts` — **offline, imports only the pure module
        (never loads `@mastra/mcp`)**:
    `parseMcpServers(undefined | '') → {}` + status "off"; valid fixture → typed entries;
    malformed JSON → exact Scenario-2 message (assert on prefix + the three actionable parts);
    command+url both/neither → entry error; transport-exclusive keys (`requestInit` on stdio,
    `env` on url) + reserved key `boilerplate` → entry error; `${MISSING}` → boot error;
    `defaultMcpApprovalPolicy`
    matrix (`delete_page`, `file-write`, `create_task`, camelCase `deleteFile`, `createIssue`,
    `removeItem`, `updateRecord` → `true`; `search`, `read_file`, `status`,
    `wikipedia_delete` boundary check on namespaced names → per table).
  - [ ] `tests/integration/mcp-stdio.test.ts` — spawns `tests/integration/helpers/echo-mcp-server.mjs`
    (tiny stdio MCP server using `@modelcontextprotocol/sdk`, itself a transitive dep of
    `@mastra/mcp` — **no npx, no network**) via `process.execPath`; asserts `listTools()` returns
    `echo_ping` with the namespace prefix, a mutating echo tool triggers the approval predicate,
    and `disconnect()` closes the subprocess. Guarded by the real top-level pattern
    (`let hasMcp = true; try { await import('@mastra/mcp'); } catch { hasMcp = false; }` then
    `describe.skipIf(!hasMcp)(...)`) so CI without the install stays green —
    mirrors `describe.skipIf(!hasProviderKey)` at `tests/integration/scope-guard-live.test.ts:17`.
  - [ ] **Singleton/instance-identity assertion closing the §3.3 ESM-ordering trap** — in
        `tests/integration/mcp-stdio.test.ts` (integration tier; a skipIf-guarded second unit
        file permitted to load `@mastra/mcp` is equally acceptable): with one stdio entry
        configured, assert **exactly one spawned stdio child process** after both
        `buildMcpClient()` and `loadMcpToolsFor()` have run, and instance identity —
        `buildMcpClient()`'s returned client `===` the instance `getMcpClient()` memoizes —
        one client, one subprocess, no duplicate masked by the explicit `id`.
  - [ ] `tests/smoke/boots.test.ts` gains: with zero env, `mastra` still registers exactly the 4
    agents, `loadMcpToolsFor('research')` resolves `{}`, and
    `mastra.listMCPServers()` (present in the installed core,
    `node_modules/@mastra/core/dist/mastra/index.d.ts:2160`) contains no `boilerplate` key.
    Smoke must stay key-free and **must not** spawn subprocesses or touch the network.
- [ ] Input/Output payload validation implemented (Zod schema in `parseMcpServers`; no `any`
      reaching `MCPClient`).
- [ ] `npm install @mastra/mcp --legacy-peer-deps` committed with `package-lock.json` (CI uses `npm ci`).
- [ ] Standard guardrails: lint (`--max-warnings=0`), `npx tsc --noEmit`, `npm run test:all` green
      offline, `timeout 15 npm run dev` verified **with and without** both new env vars valid,
      **plus one malformed run** `MCP_SERVERS='{wikipedia' timeout 15 npm run dev` that must fail
      boot printing the Scenario-2 message and never hang
      (`shared/AGENTS.md` testing requirement, extended).
- [ ] Docs:
  - [ ] Root `AGENTS.md`: two rows in the optional-infrastructure service table; **new gotcha
    #11 (per merged phase order; next free at merge time)**:
    *"MCP tool responses and tool descriptions are untrusted model input"* (naming the
    `requireToolApproval` default + Spec 06 detector pointer + `forwardInstructions:false`);
    README section "MCP: consume & expose" with both env vars and the Claude Desktop block.
  - [ ] **New MCP ADR `docs/adr/007-mcp-as-integration-boundary.md` (number FROZEN — see table)**
    (append-only numbering, never edit 001–003 — `docs/adr/AGENTS.md`): decision = "MCP is the
    single external-integration boundary (in: `MCPClient` from env JSON; out: read-only
    `MCPServer`, opt-in); hand-written per-vendor connectors stay domain code only for primitives
    with no MCP equivalent (anti-filler table, gap analysis §4 A2A/ACP row)" + the §3.3
    composition-layer carve-out + the §3.2 approval-callback serialization constraint.
    **Numbering coordination — final assignment, frozen globally at merge by phase order**
    (settlement of the earlier 004 collision; only filenames and the `docs/adr/README.md` index
    line depend on it, never the decision text):

    | spec | 01 | 02 | 03 | **04 (this)** | 05 | 06 | 07 | 08 |
    |---|---|---|---|---|---|---|---|---|
    | ADR | 004 | 005 (supersedes 003) | 006 | **007** | 008 | 009 | 010 | none |
  - [ ] `.env.example` block with the commented examples + security notes; `src/mastra/shared/AGENTS.md`
    and `src/mastra/AGENTS.md` directory tables updated.
- [ ] Work on a branch named `feat/mcp-connections` (root `AGENTS.md` GitHub conventions).
- [ ] Commits staged every 400–800 LOC; never exceed 1400 LOC per commit (code+tests first, docs
      second commit, per Conventional Commits: `feat(mcp): ...`, `docs(mcp): ...`).
- [ ] Business tests written; manual verification (Claude Desktop round-trip, Studio proxy display)
      left to the user.

## Phase 4: Risks & Open Questions

* **Risks (top 3, each with concrete mitigation):**
  * **R1 — Tool-name collisions.** Existing ids (`file-write`, `research-web-search`…) could be
    shadowed if a server key + tool name reproduces them. *Mitigation:* `listTools()` namespaces as
    `serverName_toolName` (verified), so collisions require a server literally keyed to duplicate a
    prefix; unit test asserts the merged tool map keys of `research` are unique after injection;
    on the MCPServer side docs guarantee explicit `tools:` win over derived `ask_`/`run_` names
    with a logged warning (verified:
    https://mastra.ai/reference/tools/mcp-server#configuration-properties).
  * **R2 — Compromised/third-party MCP server → prompt injection** via tool output *or* tool
    descriptions (the scope guard does not inspect either — §3.5). *Mitigation:*
    `defaultMcpApprovalPolicy` gates mutating calls (camelCase included via `toSnake`
    normalization — §3.2; **documented residual gap:** names dodging the verb list, `purge_all` /
    `wipe_bucket`, are not name-detectable — set `"requireToolApproval": true` wholesale per
    untrusted server, which is why annotations are never used to relax, only the name floor is
    default); `forwardInstructions` stays `false`;
    `allowedHosts` for URL entries; Spec 06's `PromptInjectionDetector` is the designated output
    sanitizer (noted dependency; until it ships, README marks MCP as dev-local trust boundary);
    banner warns per §3.6.
  * **R3 — Stdio subprocess environment leakage.** A spawned server inherits the SDK's curated
    whitelist by default, and any `env:` values pass verbatim. *Mitigation:* builder warns on every
    stdio entry without `"inheritDefaultEnv": false`; docs show the minimal-`env` pattern (verified:
    https://mastra.ai/reference/tools/mcp-client#security); gotcha #11 (see §3.9) tells cloners never to
    interpolate `DEEPINFRA_API_KEY`-class secrets into third-party servers.

* **Open Questions / Decisions (owner · target):**
  * **Q1 — Runtime per-user toolsets** (`listToolsets()` + custom `fetch` reading `requestContext`,
    verified at https://mastra.ai/reference/tools/mcp-client#using-custom-fetch-for-runtime-defined-authentication):
    blocked on Spec 01 auth + gap §2.4 requestContext plumbing (owned by spec **08**, custom
    routes/streaming — spec 02 is workers/pubsub and does not touch requestContext).
    Owner: spec-08 author. Target: with Spec 01 acceptance.
  * **Q2 — Stdio publishing shape:** `npm run mcp:stdio:build` (§3.7) settles the *local* run;
    still open is the published-package `bin` shape for third parties (standalone artifact baked
    into a distributable npm package; docs "Publish a stdio server package").
    Owner: boilerplate maintainer. Target: before v1.1 README freeze.
  * **Q3 — Mutating-name list:** `write|edit|delete` (settled) extended with
    `remove|drop|create|update` in §3.2 — needs sign-off that `create_*` gating isn't too noisy for
    e.g. Jira/Linear servers, and whether the `toSnake` normalization + residual-gap wording in
    §3.2/R2 is accepted as the v1 floor. Owner: user (D4 dialog). Target: implementation start.
  * **Q4 — Elicitation & OAuth (`authenticate()`, `MCPOAuthClientProvider`,
    `getServerAuthState()`):** APIs verified present, but both need interactive UX owned by
    Spec 06/HITL. Owner: spec-06 author. Target: Spec 06 draft.
  * **Ambiguity sweep addition — `MCPServer` + LibSQL/observability interplay:** exposed agent runs
    write spans through the same storage exporter; nothing to do here, but note in the MCP ADR (§3.9) that
    stdio mode (`stdio.ts`) runs *without* the HTTP server, so banner/observability wiring in that
    entry point is a minimal subset — **Owner: implementer, same PR as §3.7's esbuild entry;
    Target: PR review of the stdio artifact** (not spec-blocking).

## Phase 5: Non-Functional Requirements

* **Performance:**
  * Tool discovery at boot is bounded: `loadMcpToolsFor` uses
    `listToolsWithErrors({ perServerTimeoutMs: 3_000 })` — with a local stdio server, full
    discovery completes in < 3 s or the server is dropped to a banner warn with its duration
    (`durations` field, verified).
  * Zero-config boot cost of this feature: **deterministically zero** — with `MCP_SERVERS` unset,
    `parseMcpServers` short-circuits, `buildMcpClient` returns `{}` with no `MCPClient`
    instantiated, no subprocess spawned and no socket opened (unit-asserted by importing the pure
    `mcp-parse.ts` only; the <5 ms wall-clock figure is indicative, **not asserted** — timing
    assertions are CI-flaky).
* **Security:**
  * **100% of inbound MCP tools whose name matches `MUTATING_NAME` are approval-gated by default**
    (unit matrix in DoD; acceptance criterion O3).
  * `ENABLE_MCP_SERVER` unset ⇒ no `boilerplate` server registered (smoke-asserted); when set, the
    exposed surface contains **zero mutating primitives** (static list in `mcp/server.ts`, asserted
    in unit test).
  * Every URL-based server in documentation examples carries `allowedHosts`; stdio examples carry
    `inheritDefaultEnv: false`.
  * HTTP MCP routes carry no additional auth surface beyond `server.auth` (Spec 01 dependency
    stated in metadata; README repeats "use outside localhost requires Spec 01 auth").
* **Reliability / Availability:** a configured server that is down at boot must **never** crash
  the app: it degrades to a banner warn + excluded tools (per-server errors map, verified);
  `disconnect()` is reachable for clean shutdown. Out of the box (no `MCP_SERVERS`), `test:all`
  stays green with the network interface down — enforced by CI running the full suite offline
  like today.
* **Accessibility / Compatibility:** N/A (no UI). Compatibility (measurable): `npm run test:smoke`
  passes unchanged on Node ≥ 22.13 with zero env vars; research agent's tool map is identical to
  today's when `MCP_SERVERS` is unset; adding `@mastra/mcp` introduces no new peer-dependency
  conflict beyond `--legacy-peer-deps` (gotcha #1) — proven by `npm ci` in CI.
