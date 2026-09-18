# ADR-011: Graceful Guard Conversions and the Raw-Input Order Rule

## Status
Accepted (2026-09-18). Supersedes the **slot order** point of [ADR-009](./009-guardrails-security-processor-pipeline.md) Decision 1 (scope guard = slot 0). ADR-009 stands everywhere else: composition ownership in `buildSecurityStack`, the inert-without-key rule, ResponseCache never receiving `scope`, the workspace jail and the HITL mechanics are unchanged.

## Context

A chat incident (2026-09-18, `POST /chat/comms`): a client opened a thread with "hola", then asked a substantive question outside the agent's scope. The reply never arrived — the turn died with `Prompt injection detected. Types: injection. Reason: The content attempts to override the system's role…`.

Verified chain, in the installed `@mastra/core@1.66.0`:

1. `scope-guard:communication` classified the message as OUT and, in `redirect` mode (ADR-009 amendment 2026-09-17), **replaced the last user message's text** with the guard's declarative note.
2. The injection detector ran **after** it (slot 2) with `lastMessageOnly: true`, and that option selects exactly `[messages.at(-1)]` (`selectMessagesToCheck`) — which was by then the guard's note, not user text.
3. Its classifier labelled the note as `injection` ("restrict output format and content" — the note asks for "one sentence" and says the request was removed) and, under `strategy: 'block'`, called `abort()` → `TripWire` → the synthetic input-processor workflow threw, `chatRoute` never streamed, and nothing in the pipeline recovered.

One guard was classifying text **another guard had written**. The existing defense was copy-level only: the note is written declaratively, with an offline anti-imperative test, because "the injection detector reads the redirect note as user input" was already documented in `scope-messaging.ts`. Copy-level is brittle by construction: the verdict comes from an LLM classifier, and it failed on a real request. The same failure mode also existed for a **true** detection: the hard cut (`abort()` → TripWire) ends a user-facing turn with an error, while the product contract for the input path is a natural-language refusal the agent writes (the same principle as the scope redirect).

## Options Considered

### Option 1: Keep the order, harden the copy further
- Pros: no contract churn; no new modules.
- Cons: the discriminator is an LLM classifier — a false positive on an edit to the note's wording (or a model change) kills turns again; already failed once in production.

### Option 2: Keep the order, mark guard-written messages and skip them downstream
- Pros: preserves "scope guard = slot 0" and its structural tests.
- Cons: introduces a hidden protocol between processors; the marker must survive every transformation of the synthetic workflow (message objects are not a stable transport for private fields); fixes only the scope→injection pair, not the class.

### Option 3 (chosen): order rule + graceful conversion
- **Order rule:** raw-input scanners run BEFORE any guard that mutates the message. The injection guard moves to slot 0; the scope guard becomes the LAST mutator (slot 2), with nothing behind it that classifies (`ResponseCache` is not a classifier). No guard ever reads another guard's output.
- **Graceful conversion:** the injection slot becomes a wrapper (`injection-guard.ts`) around the unmodified `PromptInjectionDetector`. On a detection it replaces the flagged message's text with `buildInjectionRefusalInstruction(...)` — the primary model never sees the payload (same guarantee as the scope redirect) and answers a toned, short refusal in the user's language. Non-TripWire detector errors fail open, matching the detector's own internal fail-open and the scope guard's design.
- `INJECTION_GUARD_MODE=block` restores the hard cut for operators who want the pre-incident contract.
- The web-fetch tool-output scan (`scanToolOutputForInjection`) stays fail-closed and unchanged: it guards untrusted web content entering the loop, not a chat turn.

## Decision

1. `buildSecurityStack` mounts input processors as `[injection guard (slot 0, keyed), TokenLimiter (1), TokenCostControl (1.5 opt-in), scope guard (2), ResponseCache (3)]`. The order is contractual and structural tests assert the scope guard sits behind the raw-input scanner.
2. `injection-guard.ts` + `injection-messaging.ts` (new, pure copy) own the graceful conversion; `message-text.ts` (new, pure) owns the shared message surgery extracted from `scope-guard.ts` (which shrinks below the `shared/` size ceiling and loses its `LEGACY_LARGE` entry).
3. The detector's config is unchanged (`model`, `threshold`, `detectionTypes`, `lastMessageOnly: true`); the wrapper keeps its id (`prompt-injection-detector`) so the request trace stage name and the structural tests survive. The wrapper assumes `lastMessageOnly: true` — pinned by a unit test.
4. Evals change semantics, not coverage: the guardrails dataset asserts `mustRefuse` + `mustNotTripwire` (the payload never reaches the primary model) instead of `mustTripwire`; a live integration case covers the exact incident (greeting → out-of-scope, same thread, no tripwire).
5. Docs synced: spec 06 gains a dated amendment (slots table, Scenario 1, inert-rule correction — the detector's model call is fail-open in 1.66.0, the outer hard-throw covers non-model errors), root `AGENTS.md` gotchas #7/#16 + a new gotcha, `shared/AGENTS.md` processors table, README pipeline diagram/banner/env table, `.env.example`.

## Consequences

- **Positive:** the class of failure is gone structurally (no classifier consumes another guard's output); a real detection still never reaches the primary model and now ends in the natural refusal the product contract requires; `INJECTION_GUARD_MODE=block` preserves the strict option; the scope guard's toned refusal is no longer at the mercy of a second LLM verdict.
- **Negative / accepted:** the order is a documented contract change — ADR-009's decision text is not edited (per `docs/AGENTS.md`), this ADR supersedes that one point and spec 06 carries the amendment; `INJECTION_GUARD_MODE` is a new env var (two values, default `graceful`); the graceful path adds one note replacement inside the same guard-model call the detector already made — no extra model call.
- **Kept deliberately:** the injection detector still scans RAW user input (the payload is classified before any mutation); `SECURITY_PROCESSORS=log` still means "classify and log only"; the tool-output scan keeps failing closed.

## References
- Spec 06 amendment 2026-09-18 (`docs/specs/06-guardrails-and-hitl.md`)
- ADR-009 (composition, inert rule, jail, HITL — everything except the slot order)
- Regression tests: `tests/unit/shared/processors/injection-guard.test.ts`, the incident case in `security-stack.test.ts`, `tests/integration/scope-guard-live.test.ts`, `tests/evals/guardrails.eval.test.ts`
- Installed bundle evidence: `selectMessagesToCheck` (`lastMessageOnly` → `messages.at(-1)`), `handleDetectedInjection` (`block` → `abort`), `detectPromptInjection` (model failure → warns and returns nulls)
