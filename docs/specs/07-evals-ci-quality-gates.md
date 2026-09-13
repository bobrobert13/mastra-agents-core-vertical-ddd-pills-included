# Spec+: Native Evals, Experiments & Blocking CI Gates (Phase 7)

| Field | Value |
|---|---|
| **Id** | 07 |
| **Phase** | 7 — Native evals (datasets/experiments + CI gates) + typecheck + coverage (gap-analysis §5 row 7) |
| **Depends-on** | Spec 03 (recommended, not blocking): `context-precision` / `context-recall` scorers only become meaningful once vectors/RAG exist (§2.3 of the gap analysis) |
| **Status** | DRAFT |
| **Settled decision honored** | **D4 — every new CI gate in this spec is BLOCKING.** No "report-only" jobs, no soft warnings that don't fail the run. |
| **Source of truth for gaps** | `docs/PRODUCTION-GAP-ANALYSIS.md` §3.1, §3.2, §3.3 |

All Mastra APIs below were verified against the **installed** `@mastra/core@1.66.0` + `@mastra/evals@1.10.1` type definitions and the bundled reference docs (authoritative), cross-checked with https://mastra.ai/docs/evals/datasets, …/experiments, …/gates-and-verdicts, …/running-in-ci, …/built-in-scorers, and https://mastra.ai/reference/storage/retention.

---

## Phase 1: Strategic Vision

* **Vision:** Turn today's two structural eval files into what large teams actually run — versioned eval datasets and comparable experiments living in Mastra's native storage (visible in Studio), built-in LLM-judge + zero-LLM scorers registered on all four agents, and a CI pipeline where a quality regression blocks a merge exactly like a failing unit test, while a contributor without a single API key can still open a green PR.

* **OKR / Goal (PROPOSED):**
  * **KR1:** 100% of PRs that change an agent's instructions, model, or tools pass the blocking `eval-gates` verdict (`passed`) before merge. Judges never block forks; same-repo PRs additionally run them (the secret is present) and go required-red on judge regression **vs the live baseline experiment**; the keyless tier goes required-red on threshold misses and Δ > 0.02 on the deterministic gates against the committed baseline. Note honestly: the Δ-vs-experiment mechanism lives in the live tier (same-repo PR) + nightly runs — a keyless run cannot detect it, since Tier A scores frozen recorded fixtures, not the live agent.
  * **KR2:** Every agent/model/prompt change ships with a recorded comparison experiment: `compareExperiments({ experimentIds: [baseline, candidate], baselineId: baseline })` report attached to the nightly/dispatch run on `main` (Studio-visible + job-summary artifact), so "did this make the agent worse?" is answered with data, not vibes.
  * **KR3:** `npx tsc --noEmit` and coverage thresholds (`≥ 74` statements/lines, `≥ 70` branches, `≥ 55` functions — calibrated to the **measured** 74.82% / 72.48% / 60.00%) become new blocking CI jobs; typecheck + coverage add `< 6 min` to the pipeline (measured locally: 3.5 s + 9.9 s warm).
  * **KR4:** **Zero** false-red caused by missing secrets: keyless fork PRs pass every job (LLM-judge tier skips cleanly). Measured today on this machine with all keys unset: all four tiers green (45 passed, 1 skipped, 9.94 s).

**Why now:** the datasets + experiments service is GA in core ≥ 1.4 (`mastra.datasets`, `startExperiment`, `compareExperiments` — all present in the installed 1.66.0), the LibSQL adapter we already default to ships the `DatasetsLibSQL` / `ExperimentsLibSQL` / `ScorerDefinitionsLibSQL` storage domains, and `runEvals` already returns the `verdict`/`gateResults`/`thresholdResults` signal CI needs. This is the cheapest credible upgrade from "demo evals" to "production evals" (gap-analysis §3.1: *"the best effort/value eval upgrade available"*).

---

## Phase 2: Functional Spec (BDD)

* **User Story:** As a **team lead who must approve agent prompt/model changes**, I want every PR that touches an agent to automatically score that agent against versioned eval datasets and block the merge when quality regresses versus the recorded baseline, so that I can approve a `MODEL=…` swap or an instructions edit with a side-by-side experiment comparison instead of intuition — without ever seeing CI go red just because a contributor's fork has no API keys.

### Acceptance Criteria

* **Scenario 1: Happy path — PR that regresses agent quality is blocked (eval-gates verdict)**
  * **Given** `main` has a committed deterministic baseline (`tests/evals/baseline/eval-baseline.json`, produced by the live tier on `main`) and the `research` dataset is seeded in native storage
  * **When** a PR weakens `researchAgent` instructions such that the blocking gate run scores lower than baseline
  * **Then** the `test-evals` job's gate suite fails with `verdict: 'failed'` (or a `'scored'` threshold miss, which is also treated as red per D4) and the job prints the offending entries:
    ```typescript
    // tests/evals/gates/research.gates.test.ts — REAL installed API shape
    import { runEvals } from '@mastra/core/evals';
    import { checks } from '@mastra/evals/checks';
    import { createKeywordCoverageScorer } from '@mastra/evals/scorers/prebuilt';

    const result = await runEvals({
      data: seedItems,                       // loaded from native dataset (Scenario 4 seeds these)
      target: researchAgent,                 // live run — requires a key; see Scenario 5 for the keyless twin
      gates: [checks.calledTool('web_search'), checks.noToolErrors()],
      scorers: [
        { scorer: createKeywordCoverageScorer(), threshold: 0.5 },      // number = minimum
        { scorer: relevanceGateScorer, threshold: { min: 0.45 } },      // heuristic scorer wrapped as MastraScorer
      ],
    });
    // result.verdict:         'passed' | 'scored' | 'failed'   (omitted when no gates/thresholds given)
    // result.gateResults:     [{ id: 'check-called-tool', passed: false, score: 0.67 }]
    // result.thresholdResults:[{ id: 'keyword-coverage', passed: false, averageScore: 0.41, threshold: 0.5 }]
    if (result.verdict !== 'passed') {
      // regression vs committed baseline checked here too (Δ > 0.02 on any tracked mean = red)
      throw new Error(`EVAL GATE ${result.verdict}`);
    }
    ```
  * **And** the PR is unmergeable until the scores recover or the baseline is consciously updated in review.
  * **Note (verified):** gates must average **exactly 1.0** across items to pass; thresholds accept `number` (minimum) or `{ min?, max? }` — `max` is the correct form for "high score is bad" scorers like `hallucination: { max: 0.3 }`. The two `threshold: { gte: … }` snippets currently in `docs/TESTING.md` (lines 159 and 297, values 0.7 and 0.8) are **wrong API drift** and both are fixed by this spec's DoD.

* **Scenario 2: `typecheck` job fails CI on a type error**
  * **Given** a PR introduces `const x: number = agent.name;` (type error) in any file matched by `tsconfig.json` (`include: ["src/**/*", "tests/**/*"]`)
  * **When** CI runs
  * **Then** the new blocking job (verified **absent** from today's `ci.yml`, despite AGENTS.md mandating the command — gap §3.3) fails:
    ```yaml
    typecheck:
      runs-on: ubuntu-latest
      steps:                       # no needs: — runs in parallel with lint for fastest signal
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22, cache: 'npm' }
        - run: npm ci
        - run: npx tsc --noEmit    # the exact command AGENTS.md already mandates
    ```
  * **And** local time observed on this repo today: **3.5 s** (clean pass).

* **Scenario 3: Coverage threshold blocks a new uncovered file**
  * **Given** the coverage gate is calibrated to the **observed** repo state (measured 2026-09-12 locally, keys unset — see Phase 3 "Calibration"), floors are `statements/lines ≥ 74`, `branches ≥ 70`, `functions ≥ 55`
  * **When** a PR adds a 200-statement `src/` file with zero tests (pushing statements coverage 74.82% → ~68%)
  * **Then** the `coverage` job runs `npm run test:coverage:gate` (all four keyless tiers in one `vitest run --coverage`) and fails with vitest's threshold error (`ERROR Coverage statements 68.1% ... minimum 74%`), blocking merge
  * **And** the same PR re-run with `vitest.config.ts` misconfigured to include `.mastra/` build output cannot pass — the calibration fix (`include: ['src/**/*.ts']`) is part of this scenario (observed: with the current config the text reporter prints `All files 0.36 %` because the bundled build artifacts count 255k statements).

* **Scenario 4: Baseline vs candidate — `MODEL=X` vs `MODEL=Y` on the same dataset produces a `compareExperiments` report**
  * **Given** the nightly/dispatch workflow on `main` has provider secrets and has recorded `baseline-main` (agent with current `MODEL`) pinned to a dataset version
  * **When** a maintainer runs **Workflow dispatch → "Model comparison"** with `candidateModel=anthropic/claude-sonnet-4-5` (env override `MODEL_RESEARCH` — repo already resolves this in `shared/config/model.ts`)
  * **Then** the workflow executes (verified APIs, installed core):
    ```typescript
    const dataset = await mastra.datasets.get({ id: 'research-qa' });      // seeded + versioned in storage
    const pinned = (await dataset.getDetails()).version;                   // DatasetRecord.version — current snapshot
    const baseline  = await dataset.startExperiment({ name: 'baseline-main',
      targetType: 'agent', targetId: 'research-agent',
      scorers: ['answer-relevancy', 'faithfulness', 'keyword-coverage'],   // instance-registered IDs
      version: pinned, maxConcurrency: 5, maxRetries: 2 });
    const candidate = await dataset.startExperiment({ name: `pr-${process.env.GITHUB_RUN_ID}`,
      targetType: 'agent', targetId: 'research-agent',
      scorers: ['answer-relevancy', 'faithfulness', 'keyword-coverage'],
      version: pinned });                             // SAME explicit snapshot — never silently "latest"
    const report = await mastra.datasets.compareExperiments({
      experimentIds: [baseline.experimentId, candidate.experimentId],
      baselineId: baseline.experimentId,
    });
    // report (verified manager.d.ts:132-145): { baselineId, items: [{ itemId, input, groundTruth,
    //   results: Record<experimentId, { output: unknown; scores: Record<scorerId, number | null> } | null> }] }
    //   → results keyed by experimentId (object, not array); scores NUMERIC-ONLY — no `reason` text
    //     (per-item reasons come from startExperiment's summary.results[].scores or listExperimentResults)
    ```
    **Verified-shape caveats (gate round 1):** `Dataset` has no `currentVersion` property — read `(await dataset.getDetails()).version`; `startExperiment()` resolves an `ExperimentSummary` (`experimentId` / `status` / counts / timestamps / `results`) **without** a `datasetVersion` field, so the pinned version MUST be captured as a constant and passed identically to both runs (or re-read via `mastra.datasets.getExperiment({ experimentId }).datasetVersion`) — passing `undefined` would silently pin the candidate to *latest* and defeat the comparison.
    and renders the per-scorer Δ table into `$GITHUB_STEP_SUMMARY` + a JSON artifact, while **Studio** shows both runs under the dataset's **Experiments** tab with the native **Compare** UI (Studio visibility verified in the datasets/experiments docs: sidebar → Datasets → Items/Experiments/Compare, plus bulk JSON import and version diffing).
  * **And** an equivalent client-js / `npx mastra api dataset|experiment …` path exists against a reachable server (both verified in docs) — the dispatch job uses in-process boot; the CLI is the operator convenience path.

* **Scenario 5: Keyless fork PR — LLM-judge tier skips cleanly, never false-red**
  * **Given** an external contributor opens a PR from a fork (GitHub secrets resolve to `''`: `DEEPINFRA_API_KEY: ${{ secrets.DEEPINFRA_API_KEY }}` is already wired but empty)
  * **When** the `test-evals` job runs
  * **Then** the live/judge describes are inert by the repo's existing hard rule (`tests/AGENTS.md`: live model calls MUST sit behind `describe.skipIf(!hasProviderKey())`) — and the keyless `test-evals` job today contains no live suite at all, so it runs fully green; the one skip observed in the keyless four-tier run (`scope-guard-live.test.ts`, `1 skipped`, exit 0) belongs to the **`test-integration`** job, not `test-evals`
  * **And** the **keyless blocking gate** still runs and still catches real regressions through deterministic scorers only: it re-scores the **recorded outputs** fixtures (`tests/evals/fixtures/research-recorded.json`, refreshed by the live workflow on `main`) with `createKeywordCoverageScorer()` (verified code-based — takes **no options, no model**) + the heuristic `relevanceScorer` wrapped via `createScorer()`, and compares the aggregate against `eval-baseline.json`, failing when any tracked mean drops > 0.02. **`runEvals` itself cannot serve this tier** because its `target` must be a live `Agent | Workflow` (verified in installed types) — so the keyless gate calls `scorer.run()` directly per recorded fixture; this is the honest, documented two-tier contract (Phase 3).
  * **And** all of `lint, typecheck, build, coverage, test-smoke, test-unit, test-integration, test-evals` must be green keyless before merge — measured feasible: today all four tiers pass with every key unset (45/46 tests, only the intentionally-guarded live suite skipped).

---

## Phase 3: Technical Contract & DoD

### 3.1 Datasets: native storage service, git JSON stays as seed source (DECISION + justification)

Verified reality: datasets are managed by the **`mastra.datasets` service backed by a storage adapter that provides the `datasets` domain** (LibSQL qualifies — `DatasetsLibSQL` + `ExperimentsLibSQL` are exported by `@mastra/libsql@1.22.5`); there is **no filesystem-import API** in `@mastra/core` — Studio's bulk JSON import and the HTTP/client-js/`mastra api` routes all funnel into the same storage service. Item mutations use SCD-2 versioning; every add/update/delete bumps the dataset version and experiments pin a version.

**Contract:** `tests/evals/datasets/*.json` stay in git as the human-reviewable, diffable source of truth; `scripts/seed-eval-datasets.ts` pushes them into native storage idempotently:

```typescript
// scripts/seed-eval-datasets.ts — node 22 --experimental-strip-types, no alias imports
const datasetId = 'research-qa';                       // deterministic caller-supplied id
const existing = await mastra.datasets.list({ filters: { name: 'research-qa' } });
const ds = existing.datasets.find(d => d.name === 'research-qa')
  ?? await mastra.datasets.create({                    // create accepts id?, name, description?,
    id: datasetId, name: 'research-qa',                // inputSchema/groundTruthSchema (Zod — verified),
    description: 'Research agent eval cases (seeded from tests/evals/datasets/research-dataset.json)',
    inputSchema: z.object({ query: z.string() }),      // items failing schema are rejected at insert
    groundTruthSchema: z.object({ expectedAnswer: z.string(), requiredTools: z.array(z.string()), minSources: z.number() }),
    targetType: 'agent', targetIds: ['research-agent'],
    scorerIds: ['answer-relevancy', 'faithfulness', 'hallucination', 'keyword-coverage', 'research-relevance'],
  });
// per JSON item: skip when listItems({ search: item.id }) already returns it (idempotent re-seed;
// items carry a stable externalId mirroring the JSON "id" — verified identity field in the datasets storage domain)
await ds.addItems({ items: fresh.map(i => ({ input: i.input, groundTruth: i.groundTruth, externalId: i.id })) });
```

* CI/eval runs seed into a **throwaway** LibSQL file (`EVAL_STORAGE_URL=file:./eval-ci.db`) — already covered by the repo's real `.gitignore` entries (`*.db`, `*.db-journal`, `*.db-shm`, `*.db-wal` — there is no `*.db*` wildcard, but the WAL/SHM/journal sidecar variants all match); never the app's `file:./mastra.db`, so test churn doesn't pollute dev/prod datasets.
* Seed helpers live in `src/mastra/shared/evals/seed.ts` (exported `seedEvalDatasets(mastra)`) so the script, the eval tests, and the live workflow share one implementation.
* Current seeds to migrate: `research-dataset.json` (**3 items**: `research-001…003`) and `task-dataset.json` (**3 items**: `task-001…003`). The eval tier must **grow** them (target ≥ 10 items each) — a 3-item dataset cannot average meaningfully. JSON files remain canonical; storage is the runtime record.
* Production posture (ADR — proposed `docs/adr/0XX-eval-datasets-experiments-in-storage.md`, number assigned at merge time, see DoD): on Postgres deployments, the same seed script run against `DATABASE_URL` gives Studio-managed, versioned, long-lived datasets; deletion/erasure story in Phase 4.

### 3.2 Built-in scorers: which agent gets which (registration = Studio visibility)

Verified registration surface: `new Agent({ scorers })` exists in installed types (`scorers?: DynamicArgument<MastraScorers, TRequestContext>`, `agent/types.d.ts:662`), and the `Mastra` constructor accepts a `scorers` registry (`mastra/index.d.ts:239`) whose **IDs** are exactly what `startExperiment({ scorers: ['answer-relevancy', …] })` resolves and what Studio's *Run Experiment* / per-item scorer pickers list. Prebuilt constructors come from `@mastra/evals/scorers/prebuilt` (verified export list). **Verified factory reality:** the code-based (model-free, zero-LLM) variants live in `dist/scorers/code/` and are re-exported from `…/scorers/prebuilt` — `createCompletenessScorer()` takes **no arguments**, `createToneScorer(config?: { referenceTone?: string })` is the real name (**`createToneConsistencyScorer` does not exist**; registered IDs `completeness-scorer` / `tone-scorer`), and `createKeywordCoverageScorer()` likewise takes no options. Judge models must not be hard-coded strings (AGENTS.md gotcha #5): add `judgeModel()` to `shared/config/model.ts` (`EVAL_JUDGE_MODEL` > `DEFAULT_MODEL` chain; docs example uses `openai/gpt-5-mini` as default) — consumed only by the genuinely LLM-based judges.

| Agent (`targetId`) | Scorers registered | Tier | Notes |
|---|---|---|---|
| `research-agent` | `answer-relevancy` (LLM), `faithfulness` (LLM), `hallucination` (LLM, gate `max: 0.3`), `completeness` (code-based), `keyword-coverage` (code-based), `research-relevance` (heuristic wrapped with `createScorer`) | online / online / online / **offline** / **offline** / **offline** | Replaces raw `relevance-scorer.ts` usage: keep the heuristic function, wrap it as a real `MastraScorer` so it is registrable + gateable. |
| `task-management-agent` | `completeness` (code-based), `keyword-coverage`, gates `checks.calledTool('create_task')`, `checks.noToolErrors()` (zero-LLM) | **offline** / **offline** / **online-only** (checks read live tool runs) | Task fixtures assert `expectedTools`/`expectedPriority` — map to `checks.includes`/`groundTruth`. |
| `file-operations-agent` | `hallucination` (LLM, `max: 0.2` — the gotcha #7 incident agent), `keyword-coverage`, gate `checks.didNotCall` / `checks.toolOrder` | online / offline / online-only | Hallucinated tool-call regression = exactly what this agent must never ship. |
| `communication-agent` | `tone` (code-based `createToneScorer`, sentiment-difference), `bias` (LLM, `max: 0.3`), `keyword-coverage` | **offline** / online / **offline** | Minimal agent, minimal judge set. |
| *(deferred → spec 03)* | `context-precision`, `context-relevance`, `context-recall` on `research-agent` | online | Registered only when vectors/RAG exist. |

Net effect of the code-based `completeness`/`tone` correction: Tier A's keyless blocking coverage **grows** (three more deterministic scorers run on recorded fixtures) while Tier B's judge cost **shrinks** — only `answer-relevancy`, `faithfulness`, `hallucination` and `bias` make LLM calls.

`answer-similarity` and `content-similarity` are available for later; `rubric` / `multi-turn-judge` out of scope (anti-filler rule).

### 3.3 Two-tier eval gate (the honest CI contract)

`runEvals` gates/thresholds/verdicts exist in installed core and fully support offline **scorers** (`checks.*`, `keyword-coverage` are zero-LLM) — **but the run still needs a live `Agent | Workflow` target**, so *keyless CI cannot execute agents at all*. Therefore:

* **Tier A — blocking, always, keyless (`test-evals` job):**
  1. Schema/contract suites (today's structural tests, now validating the **seeded native datasets**: counts, unique `externalId`s, schema acceptance).
  2. `tests/evals/gates/*.gates.test.ts`: deterministic code-based scorers (`keyword-coverage`, `completeness`, `tone`, wrapped `research-relevance` heuristic — all verified model-free per §3.2) run via `scorer.run()` against **recorded-output fixtures**; verdict-style helper aggregates → fail on threshold miss **or** Δ > 0.02 vs `tests/evals/baseline/eval-baseline.json`.
  3. Live describes behind `describe.skipIf(!hasProviderKey())` — for same-repo PRs (secret present) these ALSO run and are effectively blocking there.
  4. `@mastra/evals/vitest` integration adopted where it fits: `await expectEvals(cfg).toPass(minPassRate)` + `registerEvalMatchers` via `setupFiles: ['@mastra/evals/vitest/setup']` (verified exports; `toPass` enforces per-gate pass-rate + thresholds natively).
* **Tier B — blocking on `main` only, never on PRs (`.github/workflows/evals-live.yml`):** `schedule` (nightly) + `workflow_dispatch` (+ `push` to `main`), with `DEEPINFRA_API_KEY` / `OPENAI_API_KEY` secrets: boots instance on ephemeral LibSQL, seeds, runs `startExperiment` baseline vs candidate with the full LLM-judge registry, posts `compareExperiments` report to the job summary + artifact, and **regenerates** `eval-baseline.json` + recorded fixtures via an auto-PR to `main` (so Tier A's keyless regression reference stays fresh).

A PR therefore never goes red because `OPENAI_API_KEY` is missing; a `main` merge whose nightly judge run regresses gets an auto-flagged baseline-PR and the human gate stays honest.

### 3.4 `ci.yml` job list after the change

| # | Job | Trigger / when | Secrets / env | Blocking | New? |
|---|---|---|---|---|---|
| 1 | `lint` | push `main`/`develop`, PR→`main` | none | yes | — |
| 2 | `typecheck` | same, no `needs` (parallel) | none | **yes** | ✅ |
| 3 | `build` | needs `lint` | none; runs **`npm run build:all`** and asserts **`.mastra/worker/index.mjs` exists** (spec 02 carry-forward) | yes | extended |
| 4 | `coverage` | needs `build` — `npm run test:coverage:gate` (all 4 tiers, keys unset) | none (LibSQL fallback) | **yes** | ✅ |
| 5 | `test-smoke` | needs `build` | none **on purpose** (zero-config proof) | yes | — |
| 6 | `test-unit` | needs `build` | none | yes | — |
| 7 | `test-integration` | needs `build` | Postgres 16 service + `DATABASE_URL`, **plus `redis:7-alpine` service + `REDIS_URL`** (spec 02 carry-forward) | yes | extended |
| 8 | `test-evals` | needs `build` | `DEEPINFRA_API_KEY: secrets` (empty on forks → live tier self-skips) | **yes** (gates per D4) | extended |

**Carry-forward rule:** this table describes `ci.yml` **as it will read after spec 02** (Redis Streams pubsub + worker build per `docs/specs/02-distributed-pubsub-workers.md`) — the Phase 7 edit adds ONLY `typecheck`, `coverage`, and the `test-evals` extension; it MUST NOT revert spec 02's `build:all` + worker-artifact assertion or the `test-integration` redis service.

All jobs keep `npm ci` + workflow-level `npm_config_legacy_peer_deps: 'true'` and `package-lock.json` committed (repo rules unchanged). New separate workflow `evals-live.yml`: `schedule` + `workflow_dispatch` + push `main`; secrets `DEEPINFRA_API_KEY` (and optional `OPENAI_API_KEY`); **not** a merge requirement for PRs.

### 3.5 Config & scripts contract

**`vitest.config.ts` coverage block (decision: keep provider `v8`; `@vitest/coverage-v8@3.2.7` MUST be added to `devDependencies` — it is NOT installed today; the config declares `provider: 'v8'` which cannot work without it. It was installed `--no-save` locally **only** to take the measurement below; repo manifests untouched by this spec):**

```typescript
coverage: {
  provider: 'v8',
  include: ['src/**/*.ts'],                  // fixes calibration: current config sweeps .mastra/ build bundles (All files: 0.36%)
  exclude: ['**/*.d.ts', 'src/**/index.ts'],
  reporter: ['text', 'json-summary', 'lcov'],// json-summary so the gate delta is machine-readable
  thresholds: { statements: 74, lines: 74, branches: 70, functions: 55 },  // = OBSERVED − ~1–5pp
},
```

**Floor validity:** the gate values above are a **floor calibrated on the pre-phase-1..6 tree (2026-09-12 measurement)** — phases 1–6 will add both source and tests, so **re-calibrate with the ratchet policy at implementation time** before merging the `coverage` job (raise or lower to measured − margin; never merge a gate that is red on its own merge commit).

**`package.json` scripts (new/changed):**

```jsonc
"test:coverage": "vitest run --coverage",
"test:coverage:gate": "vitest run --coverage",   // thresholds live in vitest.config.ts → nonzero exit = blocking gate
"typecheck": "tsc --noEmit",
"seed:eval-datasets": "node --experimental-strip-types scripts/seed-eval-datasets.ts",
"test:evals": "vitest run tests/evals"          // unchanged name; now contains gates + skipIf live tier
```

**Calibration record — OBSERVED 2026-09-12 on this machine (node 22.23.1, vitest 3.2.7, coverage-v8 3.2.7 `--no-save`, ALL provider keys + `DATABASE_URL` unset):**

| Scope | Stmts | Branch | Funcs | Lines | Detail |
|---|---|---|---|---|---|
| `tests/unit` + `tests/smoke` | **74.74%** | **71.56%** | **59.02%** | **74.74%** | 36/36 tests pass, 9.05 s |
| all 4 tiers (keyless; integration on LibSQL fallback) | **74.82%** (924/1235) | **72.48%** (79/109) | **60.00%** (36/60) | **74.82%** | 45 pass + 1 guarded skip, 9.94 s |
| `npx tsc --noEmit` | passes clean | | | | 3.5 s |

Worst offenders the gate will drag up first: `research/scorers/relevance-scorer.ts` 20.8%, `shared/config/libsql-feedback-compat.ts` 28.6%, `shared/config/storage.ts` 34.4%, `research/tools/web-fetch.ts` 45.7%.

**Estimated impact:** ~950 LOC added + ~250 modified across ~18 files — new: `scripts/seed-eval-datasets.ts` (~120), `src/mastra/shared/evals/{seed,scorers-registry,baseline-check}.ts` (~200), `tests/evals/gates/*` (~180), `tests/evals/fixtures/` + `baseline/eval-baseline.json` (~90), `.github/workflows/evals-live.yml` (~90), ADR `0XX-eval-datasets-experiments-in-storage.md` (~70 lines); modified: `vitest.config.ts`, `package.json`, `ci.yml` (+2 jobs, ~55 lines), `src/mastra/index.ts` + 4 `agent.ts` (scorers wiring ~60), `shared/config/model.ts` (`judgeModel` ~15), docs (`TESTING.md`, `AGENTS.md`, `.github/AGENTS.md`, `tests/AGENTS.md`, `docs/adr/README.md`, `scripts/AGENTS.md`, `docs/specs/08-…` deferral note, README badge optional) (~230).

**Explicitly deferred (scope carve-out):** gap-analysis §3.4 "Zod env validation" shares gap §5 row 7 with this phase but is **not** in this spec — Phase 7 stays scoped to evals + CI quality gates (§5's grouping is advisory, not binding). Per sibling-spec assignment convention, it is handed to `docs/specs/08-custom-routes-streaming-otlp.md` (exists) to absorb into its DoD at its next revision — owner: spec 08 author, target **2026-10-30** (after Phase 7 lands, per gap §5 order); if spec 08 declines, it becomes an unassigned roadmap follow-up (owner: roadmap).

### Definition of Done

- [ ] Scenarios 1–5 covered by green vitest suites + a real CI run on a scratch PR (both keyless-fork-simulated and with-secrets variants).
- [ ] **Measured current coverage recorded** (done: table above is in this spec) and the `coverage` + `typecheck` jobs merged as blocking; `@vitest/coverage-v8` added to `devDependencies` via `npm i --legacy-peer-deps -D @vitest/coverage-v8` with `package-lock.json` updated in the same commit.
- [ ] `npm run seed:eval-datasets` runs twice on a fresh file DB → zero duplicate items (idempotent), dataset visible in Studio with version 1→2 after re-seed.
- [ ] Datasets ≥ 10 items per domain (research, task-management); both legacy JSON files still parse as schema-valid seeds; JSON ↔ storage parity asserted in the eval tier.
- [ ] All 4 agents registered with the §3.2 scorer matrix; `mastra dev` Studio shows the scorers selectable in *Run Experiment* and datasets/experiments visible (verified capability — do the manual check as part of this DoD).
- [ ] Baseline artifacts (`eval-baseline.json` + recorded fixtures) generated by at least one successful `evals-live.yml` run; Tier A gate demonstrably red when a fixture score is hand-perturbed.
- [ ] **Docs contract kept in sync:** `docs/TESTING.md` (CI job table + **both** wrong `threshold: { gte }` examples fixed to `number | { min, max }` — lines 159 and 297, values 0.7 and 0.8 — + two-tier table), root `AGENTS.md` *CI gates* list (`lint, typecheck, build, coverage, test-smoke, test-unit, test-integration, test-evals` — blocking all), `.github/AGENTS.md` job table, `tests/AGENTS.md` eval-tier description, `docs/adr/README.md` index; **new optional env vars documented per repo convention**: `EVAL_STORAGE_URL` and `EVAL_JUDGE_MODEL` get a row in root `AGENTS.md`'s optional-infrastructure table + commented entries in `.env.example` (zero-config rule: unset ⇒ defaults, never an error).
- [ ] **New ADR "Eval datasets & experiments live in production storage"** — accepted (this IS architectural: new storage-domain dependency, retention/pruning lifecycle, Studio as eval UI, seed-from-git pattern). **Filename placeholder `docs/adr/0XX-eval-datasets-experiments-in-storage.md`; the final number is assigned at merge time by execution order** (gap §5 phases 1→8 map spec 01→004, 02→005, 03→006, 04→007, 05→008, 06→009, **07→010**, 08→none; sibling drafts currently collide on 004 — four-way — and 005/006 are likewise provisional; convention per spec 04 §3.9: append-only numbering, never edit accepted ADRs 001–003; only the filename + `docs/adr/README.md` index line depend on the number, **never the decision text**). Decision content: datasets/experiments are first-class storage domains (LibSQL/PG via the same adapter), git JSON stays the reviewed seed source, retention governs experiments + scores while datasets are explicitly delete-managed.
- [ ] Changesets entry (`npx changeset`) for the evals/CI feature; Conventional Commit `feat(evals): …` on branch `feat/native-evals-ci-gates`; commits ≤ 1400 LOC.
- [ ] Standard guardrails: zero-config promise intact (nothing requires env to boot or test), gotcha #5 respected (no hard-coded judge model), no live calls outside `skipIf` guards, vertical-slice imports honored (scorers per domain, registry composed in `src/mastra`).

---

## Phase 4: Risks & Open Questions

* **Risks:**
  1. **LLM-judge flakiness → CI red noise.** Judges drift and mis-score; a flaky `faithfulness` reading could block unrelated PRs. **Mitigation:** judges **never block forks** (their suites sit behind `describe.skipIf(!hasProviderKey())` and the dedicated `evals-live.yml` workflow, which is not a PR merge requirement); **same-repo PRs additionally run them** (the secret resolves), so the flakiness blast radius is limited to same-repo PRs and the nightly badge — where the live tier uses `startExperiment({ maxRetries: 2 })` (verified option, exponential backoff), bounds `hallucination` with `max` thresholds, and applies a retry-once policy on `'scored'` before reporting red; per-run `persistence` keeps storage clean. The keyless deterministic gates (code-based scorers on frozen fixtures) stay flake-free by construction.
  2. **Datasets/experiments grow unbounded in production storage.** Storage accumulates experiment results + score rows forever by default. **Mitigation (verified against retention reference):** declare `retention: { experiments: { experiments: { maxAge: '90d' } }, scores: { scorers: { maxAge: '90d' } } }` on the LibSQL/Postgres store config (results cascade-delete with their experiment; running experiments are never pruned) and call `storage.prune()` from a scheduled job. **Caveat verified from the same docs:** datasets are user-authored config and explicitly NOT retention-eligible — dataset bloat/pruning is handled by the git-seed pattern (storage mirror of small, reviewed JSON), `mastra.datasets.delete`, and `purgeItem()` for erasure (SCD-2 tombstones keep history otherwise).
  3. **Coverage gate punishes tests-free refactors / discourages feature work at the floor.** **Mitigation:** ratchet policy — thresholds may only move **up** (quarterly review when measured ≥ floor + 2 pp, e.g. 74 → 76); the gate runs on aggregate `src/` scope only (no per-file cliff for a single new file), and the emergency escape is an explicit `coverage.thresholds` override in a reviewed config PR, never a silent `--no-verify`.

* **Open Questions / Decisions:**
  - **Does the eval tier need a real database in CI?** → **RESOLVED (verified):** No. Datasets/experiments work on LibSQL (`DatasetsLibSQL`/`ExperimentsLibSQL` domains present in the installed adapter; official docs quickstart itself uses `LibSQLStore` + `file:./mastra.db`). A per-run `file:./eval-ci.db` suffices; Postgres stays optional (only the full observability-feedback surface needs it, per root AGENTS.md gotcha #8). Owner: implementing agent; revisit only if pg-specific dataset behavior is ever relied on.
  - **Who refreshes `eval-baseline.json` + recorded fixtures, and how is the auto-PR authorized?** (proposed: nightly workflow opens it with the repo token; needs maintainer sign-off on auto-PRs to `main`). Owner: team lead — **decide by 2026-10-05** (must precede merging `evals-live.yml` on its schedule).
  - **Judge model default when no `EVAL_JUDGE_MODEL` is set:** proposed `judgeModel()` fallback = same chain as `DEFAULT_MODEL` (provider-agnostic), documented as such — confirm the team doesn't want a pinned cheap judge (docs example `openai/gpt-5-mini`) for cost determinism. Owner: team lead — **decide by 2026-10-07** (blocks nothing beyond the registry PR).
  - **Studio visibility parity check** on Postgres vs LibSQL for the *Compare Experiments* UI — capability confirmed in docs; manual verification runs inside this spec's DoD execution. Owner: implementer — **report by 2026-10-16** (with the Phase 7 validation PR).

---

## Phase 5: Non-Functional Requirements

* **Performance:** `typecheck` + `coverage` jobs together `< 6 min` wall-clock in CI including `npm ci` (local warm measurements: 3.5 s + 9.9 s → headroom ≫; each job's `npm ci` ≈ 40–60 s dominates). Live experiment: `maxConcurrency: 5`, `itemTimeout: 30_000` per item — nightly tier completes ≤ 200 dataset items in `< 15 min`.
* **Security:** No provider secrets ever required for PR-green; secrets only consumed by the live workflow (read-only scoped), never echoed into job summaries; experiment artifacts contain generated text only; `externalId` fields never store sensitive data (verified docs warning: `externalId` survives item purge).
* **Reliability / Availability:** **0 false-red** on keyless forks across 20 consecutive sample PR runs (acceptance-tested before flipping jobs required); eval gates deterministic at aggregate level (fixtures + code-based scorers → byte-stable verdict); live tier failures page nobody — they surface as a red nightly badge + baseline-PR, never as a blocked contributor.
* **Quality gate (blocking, D4):** statements/lines ≥ **74**, branches ≥ **70**, functions ≥ **55** (observed: 74.82 / 72.48 / 60.00); eval gate Δ vs baseline `≤ 0.02` per tracked scorer mean; verdict must be exactly `passed`.
* **Accessibility / Compatibility:** N/A (no UI surface changes; Studio is upstream).
