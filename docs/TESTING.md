# Testing Strategy - Mastra Boilerplate

## 📋 Overview

This document outlines the comprehensive testing strategy for the Mastra boilerplate, covering unit tests, integration tests, and E2E evaluations using Mastra's evals framework.

## 🏗️ Testing Pyramid

```
        ┌─────────────┐
        │   Human     │  ← Quarterly
        │ Evaluation  │
        ├─────────────┤
        │  LLM-based  │  ← Nightly (live evals, roadmap)
        │   Scorers   │
        ├─────────────┤
        │ Integration │  ← Every PR
        │    Tests    │
        ├─────────────┤
        │ Unit Tests  │  ← Every commit
        │ + Gates     │
        ├─────────────┤
        │ Smoke /     │  ← Every commit: zero-config
        │ Boot        │     instance construction
        └─────────────┘
```

## 🧪 Test Types

### 0. Smoke Tests

**Purpose**: Prove the boilerplate's core promise — the entire Mastra instance constructs with **zero env vars** (LibSQL fallback storage, provider-agnostic model defaults) and registers all domains + workflows. Deterministic and offline: no model calls.

**Location**: `tests/smoke/boots.test.ts` (importing `src/mastra/index.ts` runs the real composition root)

**Run**:
```bash
npm run test:smoke
```

**What it asserts**: `listAgents()` exposes exactly `research/tasks/files/comms`; each agent has id, name and a resolved model string; `getStorage()` is defined.

### 1. Unit Tests

**Purpose**: Fast, deterministic tests for individual components

**Location**: `tests/unit/`

**Structure**:
```
tests/unit/
├── domains/
│   ├── research/
│   │   ├── agent.test.ts
│   │   └── tools/
│   │       ├── web-search.test.ts
│   │       └── summarize.test.ts
│   ├── task-management/
│   │   ├── agent.test.ts
│   │   └── tools/
│   │       └── create-task.test.ts
│   ├── file-operations/
│   └── communication/
└── shared/
    └── event-bus.test.ts
```

**Run**:
```bash
npm run test:unit
```

**Best Practices**:
- Test one thing per test
- Use descriptive test names
- Mock external dependencies
- Keep tests fast (< 100ms each)
- Aim for 80%+ coverage

### 2. Integration Tests

**Purpose**: Test cross-domain interactions and workflows

**Location**: `tests/integration/`

**Structure**:
```
tests/integration/
└── cross-domain.test.ts
```

**Run**:
```bash
npm run test:integration
```

**What to Test**:
- Event bus communication between domains
- Workflow execution across steps
- Multi-agent collaboration
- Database interactions

### 3. Structural Evals (Mastra Evals-ready)

**Purpose**: Assert agent contracts (identity, model resolution via `shared/config/model.ts`) and dataset schemas. **Offline-safe** — no model calls, so CI is green without provider keys. To grow these into live LLM evals, wire the datasets into `@mastra/evals` scorers behind a `describe.skipIf(!hasKey)` guard.

**Location**: `tests/evals/`

**Structure**:
```
tests/evals/
├── datasets/
│   ├── research-dataset.json
│   └── task-dataset.json
├── research.eval.test.ts
└── task-management.eval.test.ts
```

**Run**:
```bash
npm run test:evals
```

**Components**:
- **Gates**: Hard requirements (must pass 1.0)
  - `checks.calledTool('toolName')`
  - `checks.noToolErrors()`
  - `checks.includes('substring')`
  
- **Scorers**: Quality metrics with thresholds
  - `createAnswerRelevancyScorer()`
  - `createFaithfulnessScorer()`
  - Custom domain scorers

**Example**:
```typescript
import { runEvals } from '@mastra/core/evals';
import { checks } from '@mastra/evals/scorers/code';
import { createAnswerRelevancyScorer } from '@mastra/evals/scorers/llm';

const result = await runEvals({
  target: researchAgent,
  data: [
    {
      input: 'What is the weather in Quito?',
      groundTruth: {
        answer: 'The weather in Quito is...',
        requiredTools: ['web_search']
      }
    }
  ],
  gates: [
    checks.calledTool('web_search'),
    checks.noToolErrors()
  ],
  scorers: [
    {
      scorer: createAnswerRelevancyScorer(),
      threshold: { gte: 0.7 }
    }
  ]
});

expect(result.verdict).not.toBe('failed');
```

## 📊 Datasets

### Creating Datasets

```typescript
import { Mastra } from '@mastra/core';
import { z } from 'zod';

const dataset = await mastra.datasets.create({
  name: 'research-qa',
  description: 'Test cases for research agent',
  inputSchema: z.object({
    query: z.string(),
  }),
  groundTruthSchema: z.object({
    expectedAnswer: z.string(),
    requiredTools: z.array(z.string()),
  }),
});

await dataset.addItems({
  items: [
    {
      input: { query: 'What is TypeScript?' },
      groundTruth: {
        expectedAnswer: 'TypeScript is...',
        requiredTools: ['web_search'],
      },
    },
  ],
});
```

### Dataset Structure

```json
{
  "name": "research-dataset",
  "items": [
    {
      "input": {
        "query": "What is the weather in Quito?"
      },
      "groundTruth": {
        "answer": "The weather in Quito is...",
        "requiredTools": ["web_search", "web_fetch"]
      }
    }
  ]
}
```

## 🎯 Scorers by Domain

| Domain | Scorers | Sampling | Threshold |
|---|---|---|---|
| **research** | answer-relevancy, faithfulness | 10% | 0.7 |
| **task-management** | completeness, tool-call-accuracy | 20% | 0.8 |
| **file-operations** | tool-call-accuracy, noToolErrors | 100% | 1.0 |
| **communication** | tone-consistency | 5% | 0.6 |

## 🔄 CI/CD Integration

### GitHub Actions

Real pipeline: `.github/workflows/ci.yml` (source of truth — keep this summary in sync).

| Job | Runs | Notes |
|---|---|---|
| `lint` | `npm run lint` | ESLint with `--max-warnings=0` (0 errors / 0 warnings enforced) |
| `build` | `npm run build:all` | needs lint; builds API + worker artifacts, asserts `.mastra/worker/index.mjs` |
| `test-smoke` | `npm run test:smoke` | **no env block on purpose** — proves zero-config boot |
| `test-unit` | `npm run test:unit` | deterministic |
| `test-integration` | `npm run test:integration` | Postgres 16 + `DATABASE_URL`; Redis 7 service + `REDIS_URL` (skips pubsub tests when unset) |
| `test-evals` | `npm run test:evals` | structural, offline-safe; optional `DEEPINFRA_API_KEY` secret |

Workflow-level `env: npm_config_legacy_peer_deps: 'true'` makes `npm ci` match the committed lockfile's resolution (see root `AGENTS.md` gotcha #1).

## 📈 Coverage Goals

| Test Type | Coverage Goal | Frequency |
|---|---|---|
| Unit Tests | 80%+ | Every commit |
| Integration Tests | 70%+ | Every PR |
| Evals | N/A (quality metrics) | Nightly |

## 🛠️ Commands

```bash
# Run all tests (smoke → unit → integration → evals)
npm run test:all

# Run specific test suites
npm run test:smoke
npm run test:unit
npm run test:integration
npm run test:evals

# Type check (covers src + tests, like CI's implicit gate)
npx tsc --noEmit

# Watch mode
npm run test:watch

# Coverage report
npm run test:unit -- --coverage
```

## 📚 Best Practices

### 1. Tiered Testing Strategy
- **Fast deterministic checks** in CI on every commit
- **LLM-based scorers** in nightly builds
- **Human evaluation** quarterly calibration

### 2. Start Small
- Begin with 20-50 real-world test cases
- Define clear success criteria before building
- Use `checks.*` for fast feedback

### 3. Use Gates + Scorers Together
```typescript
// Gates: Hard requirements (must pass 1.0)
gates: [
  checks.calledTool('searchTool'),
  checks.noToolErrors()
]

// Scorers: Quality metrics with thresholds
scorers: [
  { scorer: relevancyScorer, threshold: { gte: 0.8 } }
]
```

### 4. Version Your Datasets
- Pin experiments to specific dataset versions
- Track quality over time across model/prompt changes

### 5. Control Costs
- Use sampling for expensive LLM judges
- Run quick checks frequently, expensive evals less often

## 🔍 Debugging Tests

### Common Issues

**Issue**: Tests timeout
**Solution**: Increase timeout in vitest.config.ts
```typescript
testTimeout: 60000 // 60 seconds
```

**Issue**: Flaky eval tests
**Solution**: Use tool mocks for deterministic runs
```typescript
const toolMocks = collectToolMocks(trajectory.steps);
await dataset.addItems({
  items: [{ input, toolMocks, groundTruth }]
});
```

**Issue**: High API costs
**Solution**: Reduce sampling rate
```typescript
sampling: { type: 'ratio', rate: 0.1 } // 10% instead of 100%
```

## 📖 Resources

- [Mastra Evals Documentation](https://mastra.ai/docs/evals/overview)
- [Built-in Scorers](https://mastra.ai/docs/evals/built-in-scorers)
- [Running Scorers in CI](https://mastra.ai/docs/evals/running-in-ci)
- [Vitest Documentation](https://vitest.dev/)
