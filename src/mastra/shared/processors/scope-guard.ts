import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { InputProcessor } from '@mastra/core/processors';
import { guardModel } from '../config/model';
import { hasAnyProviderKey } from '../config/providers';
import { logger } from '../logger';

/** Plain, import-free description of one domain's boundaries. */
export interface DomainScope {
  domain: string;
  agentName: string;
  /** One line the agent will never answer outside of. */
  scope: string;
  outOfScopeExamples: string[];
  /** Other agents the user can be redirected to (plain data — no cross-domain imports). */
  siblings: Array<{ name: string; description: string }>;
}

export interface ScopeVerdict {
  inScope: boolean;
}

export interface ScopeGuardOptions extends DomainScope {
  /** Classifier model id; default guardModel(). */
  model?: string;
  /** Injectable classifier (offline tests); default uses an internal provider-agnostic Agent. */
  classify?: (text: string) => Promise<ScopeVerdict>;
  /** Default: on unless SCOPE_GUARD=off. */
  enabled?: boolean;
}

interface MessageLike {
  role?: string;
  content?: { parts?: unknown[] };
}

function extractLastUserText(messages: MessageLike[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    const parts = message.content?.parts;
    if (!Array.isArray(parts)) continue;
    const text = parts
      .filter(
        (part): part is { type: string; text?: string } =>
          typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text'
      )
      .map(part => part.text ?? '')
      .join(' ')
      .trim();
    if (text) return text;
  }
  return '';
}

/**
 * Hard scope enforcement for every domain agent: classifies the last user
 * message and aborts (TripWire, before the LLM runs) when it falls outside
 * the agent's scope — so a specialist never answers off-topic from model
 * knowledge and never tool-calls on hallucinated input.
 *
 * Classifier errors fail OPEN (message passes, warning logged): the guard
 * must never break legitimate traffic, and with no provider key configured
 * it is inert by design. Set SCOPE_GUARD=off to disable; SCOPE_GUARD_MODEL
 * to pick a cheaper classifier model.
 */
export function createScopeGuard(options: ScopeGuardOptions): InputProcessor {
  const {
    domain,
    agentName,
    scope,
    outOfScopeExamples,
    siblings,
    model = guardModel(),
    classify,
    enabled = process.env.SCOPE_GUARD !== 'off',
  } = options;

  const id = `scope-guard:${domain}`;

  let classifierAgent: Agent | undefined;
  const llmClassify = async (text: string): Promise<ScopeVerdict> => {
    classifierAgent ??= new Agent({
      id: `${id}:classifier`,
      name: 'Scope Classifier',
      instructions:
        'You are a strict topic classifier. Decide whether the user message falls within the declared agent scope. Use structured output only.',
      model,
    });
    const prompt = [
      `Agent scope: ${scope}`,
      `Typical out-of-scope messages: ${outOfScopeExamples.join(' | ')}`,
      '',
      `User message:`,
      text,
    ].join('\n');
    const result = await classifierAgent.generate(prompt, {
      structuredOutput: { schema: z.object({ inScope: z.boolean() }) },
      modelSettings: { temperature: 0 },
    });
    const object = result.object as ScopeVerdict | undefined;
    return { inScope: object?.inScope !== false };
  };

  const runClassification = classify ?? llmClassify;
  // Without any provider key the built-in classifier cannot run; the banner
  // already reports "Scope guard: inert". Injected classifiers (tests) always run.
  const inertByDefault = !classify && !hasAnyProviderKey();

  return {
    id,
    processInput: async args => {
      if (!enabled || inertByDefault) return args.messages;

      const text = extractLastUserText(args.messages as MessageLike[]);
      if (!text) return args.messages;

      let verdict: ScopeVerdict;
      try {
        verdict = await runClassification(text);
      } catch (error) {
        logger.warn(
          `[${id}] scope classification failed — passing input through (fail-open):`,
          error
        );
        return args.messages;
      }

      if (verdict.inScope) return args.messages;

      const redirect = siblings.map(s => `${s.name} (${s.description})`).join('; ');
      args.abort(
        `${agentName} only handles ${scope}. Your message appears unrelated to this agent's scope. Try instead: ${redirect}.`
      );
      // abort() throws TripWire at runtime; unreachable, kept for the return contract.
      return args.messages;
    },
  };
}
