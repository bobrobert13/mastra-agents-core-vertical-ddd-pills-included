import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inputProcessors, outputProcessors } from '../../../../src/mastra/shared/agents/security';

let saved: Record<string, string | undefined> = {};
const keys = ['SECURITY_PROCESSORS', 'SECURITY_MODEL', 'MODEL', 'TOKEN_LIMIT', 'OPENAI_API_KEY'];

beforeEach(() => {
  saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
});

afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('security processors', () => {
  it('defaults to the deterministic token limiter only', () => {
    expect(inputProcessors().map(p => p.id)).toEqual(['token-limiter']);
    expect(outputProcessors()).toEqual([]);
  });

  it('mounts native LLM detectors only when opt-in and keyed', () => {
    process.env.SECURITY_PROCESSORS = 'active';
    process.env.OPENAI_API_KEY = 'sk-test-never-called';
    expect(inputProcessors().map(p => p.id)).toContain('prompt-injection-detector');
    expect(outputProcessors().map(p => p.id)).toContain('pii-detector');
  });
});
