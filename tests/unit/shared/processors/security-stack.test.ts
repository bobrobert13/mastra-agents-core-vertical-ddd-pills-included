/**
 * Spec 06 §3.8 — security-stack composition unit tier.
 * Deterministic: NO model calls anywhere. The LLM detectors are only
 * CONSTRUCTED (config assertions via instance fields) and the inert rule
 * (detectors absent without a provider key) is exercised by DELETING the
 * provider-key env vars in-test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TripWire } from '@mastra/core/agent';
import {
  buildSecurityStack,
  registerSecurityStackStatus,
  scanToolOutputForInjection,
  securityMode,
  securityModel,
} from '../../../../src/mastra/shared/processors/security-stack';
import type { DomainScope } from '../../../../src/mastra/shared/processors/scope-guard';

const scope: DomainScope = {
  domain: 'unit-test',
  agentName: 'Unit Test Agent',
  scope: 'deterministic stack assembly',
  outOfScopeExamples: ['anything else'],
  siblings: [],
};

const PROVIDER_KEYS = [
  'DEEPINFRA_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
];
const STACK_ENV = [
  'SECURITY_PROCESSORS',
  'SECURITY_MODEL',
  'PI_THRESHOLD',
  'TOKEN_LIMIT',
  'RESPONSE_CACHE',
  'RESPONSE_CACHE_TTL',
  'COST_LIMIT_USD',
  'SCOPE_GUARD',
  'SCOPE_GUARD_MODEL',
  'MODEL',
  'DEFAULT_MODEL',
  'FILE_JAIL',
  'REVIEW_APPROVAL',
];

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = {};
  for (const key of [...PROVIDER_KEYS, ...STACK_ENV]) saved[key] = process.env[key];
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function clearProviderKeys(): void {
  for (const key of PROVIDER_KEYS) delete process.env[key];
}
function setProviderKey(): void {
  // Never used for a call — construction is offline (verified against 1.66.0).
  process.env.OPENAI_API_KEY = 'sk-test-key-never-called';
}

const ids = (list: Array<{ id: string }>): string[] => list.map(p => p.id);

describe('securityMode / securityModel', () => {
  it('resolves SECURITY_PROCESSORS to active | log | off (default active)', () => {
    delete process.env.SECURITY_PROCESSORS;
    expect(securityMode()).toBe('active');
    process.env.SECURITY_PROCESSORS = 'log';
    expect(securityMode()).toBe('log');
    process.env.SECURITY_PROCESSORS = 'OFF';
    expect(securityMode()).toBe('off');
  });

  it('SECURITY_MODEL > guardModel() chain (never the primary model by default)', () => {
    clearProviderKeys();
    process.env.SECURITY_MODEL = 'anthropic/claude-sonnet-4-5';
    expect(securityModel()).toBe('anthropic/claude-sonnet-4-5');
    delete process.env.SECURITY_MODEL;
    process.env.SCOPE_GUARD_MODEL = 'deepinfra/qwen-tiny';
    expect(securityModel()).toBe('deepinfra/qwen-tiny');
    delete process.env.SCOPE_GUARD_MODEL;
    process.env.MODEL = 'openai/gpt-4o-mini';
    expect(securityModel()).toBe('openai/gpt-4o-mini');
  });
});

describe('buildSecurityStack — composition order', () => {
  it('SECURITY_PROCESSORS=off ⇒ the scope guard ALONE (today byte-for-byte)', () => {
    setProviderKey();
    process.env.SECURITY_PROCESSORS = 'off';
    const stack = buildSecurityStack({ scope });
    expect(ids(stack.inputProcessors)).toEqual(['scope-guard:unit-test']);
    expect(stack.outputProcessors).toHaveLength(0);
  });

  it('active + provider key ⇒ [guard, token-limiter, injection, cache] + [pii]', () => {
    setProviderKey();
    const stack = buildSecurityStack({ scope });
    expect(ids(stack.inputProcessors)).toEqual([
      'scope-guard:unit-test',
      'token-limiter',
      'prompt-injection-detector',
      'mastra/response-cache',
    ]);
    expect(ids(stack.outputProcessors)).toEqual(['pii-detector']);
  });

  it('INERT RULE: without a provider key the LLM detectors are absent (they hard-throw on guard-model failure)', () => {
    clearProviderKeys();
    const stack = buildSecurityStack({ scope });
    expect(ids(stack.inputProcessors)).toEqual([
      'scope-guard:unit-test',
      'token-limiter',
      'mastra/response-cache',
    ]);
    expect(stack.outputProcessors).toHaveLength(0);
    expect(stack.inputProcessors.some(p => p.id === 'prompt-injection-detector')).toBe(false);
  });

  it('log mode ⇒ detectors constructed with warn strategies (classification runs, nothing blocks)', () => {
    setProviderKey();
    process.env.SECURITY_PROCESSORS = 'log';
    const stack = buildSecurityStack({ scope });
    const pid = stack.inputProcessors.find(p => p.id === 'prompt-injection-detector') as never as {
      strategy: string;
    };
    const pii = stack.outputProcessors[0] as never as { strategy: string };
    expect(pid.strategy).toBe('warn');
    expect(pii.strategy).toBe('warn');
  });

  it('TokenLimiter honours TOKEN_LIMIT, default 8000', () => {
    setProviderKey();
    process.env.TOKEN_LIMIT = '1234';
    let stack = buildSecurityStack({ scope });
    const limiter = stack.inputProcessors.find(p => p.id === 'token-limiter') as unknown as {
      getMaxTokens(): number;
    };
    expect(limiter.getMaxTokens()).toBe(1234);
    delete process.env.TOKEN_LIMIT;
    stack = buildSecurityStack({ scope });
    const fallback = stack.inputProcessors.find(p => p.id === 'token-limiter') as unknown as {
      getMaxTokens(): number;
    };
    expect(fallback.getMaxTokens()).toBe(8000);
  });

  it('PI_THRESHOLD overrides the detector confidence threshold', () => {
    setProviderKey();
    process.env.PI_THRESHOLD = '0.42';
    const stack = buildSecurityStack({ scope });
    const pid = stack.inputProcessors.find(p => p.id === 'prompt-injection-detector') as never as {
      threshold: number;
    };
    expect(pid.threshold).toBe(0.42);
  });

  it('PIIDetector config: mask + regex-only types (LLM-only name/address/dob excluded)', () => {
    setProviderKey();
    const stack = buildSecurityStack({ scope });
    const pii = stack.outputProcessors[0] as never as {
      redactionMethod: string;
      detectionTypes: string[];
      includeDetections: boolean;
      threshold: number;
    };
    expect(pii.redactionMethod).toBe('mask');
    expect(pii.threshold).toBe(0.6);
    expect(pii.includeDetections).toBe(true);
    expect(pii.detectionTypes).toEqual(['email', 'phone', 'credit-card', 'ssn', 'ip-address']);
    expect(pii.detectionTypes).not.toContain('name');
  });

  it('ResponseCache: last input slot, agentId namespaced by domain, ttl from env, scope NEVER set (risk R2)', () => {
    setProviderKey();
    process.env.RESPONSE_CACHE_TTL = '60';
    const stack = buildSecurityStack({ scope });
    const cache = stack.inputProcessors[stack.inputProcessors.length - 1];
    expect(cache.id).toBe('mastra/response-cache');
    const opts = (cache as never as { options: Record<string, unknown> }).options;
    expect('scope' in opts).toBe(false);
    expect(opts.ttl).toBe(60);
    expect(opts.agentId).toBe('unit-test');
  });

  it('cache removal: RESPONSE_CACHE=off or disableResponseCache (mutating-tool agents)', () => {
    setProviderKey();
    process.env.RESPONSE_CACHE = 'off';
    expect(ids(buildSecurityStack({ scope }).inputProcessors)).not.toContain(
      'mastra/response-cache'
    );
    delete process.env.RESPONSE_CACHE;
    expect(
      ids(buildSecurityStack({ scope, disableResponseCache: true }).inputProcessors)
    ).not.toContain('mastra/response-cache');
  });

  it('TokenCostControl is OPT-IN only (COST_LIMIT_USD): slot 1.5, never unconditional', () => {
    setProviderKey();
    expect(ids(buildSecurityStack({ scope }).inputProcessors)).not.toContain('token-cost-control');
    process.env.COST_LIMIT_USD = '5';
    const stack = buildSecurityStack({ scope });
    expect(ids(stack.inputProcessors)[2]).toBe('token-cost-control');
    const tcc = stack.inputProcessors[2] as never as { maxCost: unknown; window: string };
    expect(Number(tcc.maxCost)).toBe(5);
    expect(tcc.window).toBe('24h');
  });

  it('extraInput is appended last (domain-specific processors)', () => {
    setProviderKey();
    const custom = {
      id: 'custom-processor',
      processInput: async (args: { messages: unknown[] }) => args.messages,
    };
    const stack = buildSecurityStack({ scope, extraInput: [custom as never] });
    expect(stack.inputProcessors.at(-1)?.id).toBe('custom-processor');
  });
});

describe('TokenLimiter runtime semantics (Scenario 3)', () => {
  function stubMessageList(system: string[], users: string[]) {
    const messages = users.map((text, i) => ({
      id: `u${i}`,
      role: 'user',
      content: { format: 'content-v2', parts: [{ type: 'text', text }] },
    }));
    return {
      messages,
      get: { all: { db: () => messages } },
      getAllSystemMessages: () => system.map(content => ({ role: 'system' as const, content })),
      removeByIds: (idsToRemove: string[]) => {
        const drop = new Set(idsToRemove);
        for (let i = messages.length - 1; i >= 0; i--) {
          if (drop.has(messages[i].id)) messages.splice(i, 1);
        }
      },
    };
  }

  it('over-budget SYSTEM prompt alone ⇒ TripWire with { systemTokens, limit } metadata', async () => {
    const { TokenLimiter } = await import('@mastra/core/processors');
    const limiter = new TokenLimiter({ limit: 50 });
    const list = stubMessageList(['x '.repeat(4000)], ['hola']);

    const error = await limiter
      .processInputStep({ messageList: list } as never)
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TripWire);
    const trip = error as TripWire;
    expect(trip.message).toContain('System messages alone exceed token limit');
    const metadata = trip.options.metadata as Record<string, number>;
    expect(metadata.systemTokens).toBeGreaterThan(50);
    expect(metadata.limit).toBe(50);
    expect(Object.keys(metadata).sort()).toEqual(['limit', 'systemTokens']);
  });

  it('empty history ⇒ TripWire (nothing to send)', async () => {
    const { TokenLimiter } = await import('@mastra/core/processors');
    const limiter = new TokenLimiter({ limit: 50 });
    const list = stubMessageList(['small'], []);
    const error = await limiter
      .processInputStep({ messageList: list } as never)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TripWire);
  });

  it('over-budget history (normal case) ⇒ silent prune, system kept, request proceeds', async () => {
    const { TokenLimiter } = await import('@mastra/core/processors');
    const limiter = new TokenLimiter({ limit: 400 });
    const users = Array.from({ length: 20 }, (_, i) => `word `.repeat(80) + i);
    const list = stubMessageList(['tiny system'], users);

    await expect(limiter.processInputStep({ messageList: list } as never)).resolves.toBeUndefined();
    expect(list.messages.length).toBeLessThan(20);
    expect(list.messages.length).toBeGreaterThan(0);
    // most recent kept
    expect(
      (
        (list.messages.at(-1)!.content as { parts: unknown[] }).parts[0] as { text: string }
      ).text.endsWith('19')
    ).toBe(true);
  });
});

describe('registerSecurityStackStatus (banner, §3.7)', () => {
  it('three documented variants + ⚠ escape-hatch clauses', () => {
    clearProviderKeys();

    const active: Array<Record<string, unknown>> = [];
    setProviderKey();
    registerSecurityStackStatus(active as never, true);
    expect(active[0]).toMatchObject({ name: 'Guardrails', active: true });
    expect(String(active[0].detail)).toContain('injection|pii|token-limit|cache active (block)');

    const inert: Array<Record<string, unknown>> = [];
    clearProviderKeys();
    registerSecurityStackStatus(inert as never, false);
    expect(String(inert[0].detail)).toContain(
      'injection|pii inert without provider key; token-limit|cache active'
    );

    const off: Array<Record<string, unknown>> = [];
    process.env.SECURITY_PROCESSORS = 'off';
    registerSecurityStackStatus(off as never, true);
    expect(off[0].active).toBe(false);
    expect(String(off[0].detail)).toContain('SECURITY_PROCESSORS=off');

    const log: Array<Record<string, unknown>> = [];
    process.env.SECURITY_PROCESSORS = 'log';
    process.env.FILE_JAIL = 'off';
    process.env.REVIEW_APPROVAL = 'off';
    registerSecurityStackStatus(log as never, true);
    expect(String(log[0].detail)).toContain('log-only');
    expect(String(log[0].detail)).toContain('⚠ FILE_JAIL=off');
    expect(String(log[0].detail)).toContain('⚠ REVIEW_APPROVAL=off');
  });
});

describe('scanToolOutputForInjection (web-fetch scanning boundary, Q3)', () => {
  it('inert without a provider key — resolves without any model call', async () => {
    clearProviderKeys();
    await expect(scanToolOutputForInjection('anything', 'https://x.test')).resolves.toBeUndefined();
  });

  it('inert with SECURITY_PROCESSORS=off', async () => {
    setProviderKey();
    process.env.SECURITY_PROCESSORS = 'off';
    await expect(scanToolOutputForInjection('anything', 'https://x.test')).resolves.toBeUndefined();
  });
});
