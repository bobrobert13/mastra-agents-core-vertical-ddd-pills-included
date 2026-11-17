// Mastra processors: https://mastra.ai/docs/agents/processors
import {
  PIIDetector,
  PromptInjectionDetector,
  TokenLimiter,
  type InputProcessor,
  type OutputProcessor,
} from '@mastra/core/processors';
import { DEFAULT_MODEL } from '../config/model';

const PROVIDER_KEYS = [
  'DEEPINFRA_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
];

function hasProviderKey(): boolean {
  return PROVIDER_KEYS.some(key => (process.env[key] ?? '').trim() !== '');
}

function llmGuardrailsActive(): boolean {
  return process.env.SECURITY_PROCESSORS === 'active' && hasProviderKey();
}

function guardModel(): string {
  return process.env.SECURITY_MODEL?.trim() || process.env.MODEL?.trim() || DEFAULT_MODEL;
}

export function inputProcessors(): InputProcessor[] {
  const limit = Number(process.env.TOKEN_LIMIT ?? 8000);
  const deterministic: InputProcessor[] = [
    new TokenLimiter({ limit: Number.isFinite(limit) && limit > 0 ? limit : 8000 }),
  ];
  if (!llmGuardrailsActive()) return deterministic;

  return [
    new PromptInjectionDetector({
      model: guardModel(),
      threshold: 0.8,
      strategy: 'warn',
      detectionTypes: ['injection', 'jailbreak', 'system-override'],
      lastMessageOnly: true,
      structuredOutputOptions: { jsonPromptInjection: true },
    }),
    ...deterministic,
  ];
}

export function outputProcessors(): OutputProcessor[] {
  if (!llmGuardrailsActive()) return [];
  return [
    new PIIDetector({
      model: guardModel(),
      threshold: 0.6,
      strategy: 'redact',
      redactionMethod: 'mask',
      detectionTypes: ['email', 'phone', 'credit-card', 'ssn', 'ip-address'],
      includeDetections: true,
      structuredOutputOptions: { jsonPromptInjection: true },
    }),
  ];
}
