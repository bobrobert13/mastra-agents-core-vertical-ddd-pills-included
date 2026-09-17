import { Agent } from '@mastra/core/agent';
import type { InputProcessor } from '@mastra/core/processors';
import { guardModel } from '../config/model';
import {
  hasAnyProviderKey,
  readScopeGuardMode,
  readScopeGuardTone,
  type ScopeGuardMode,
} from '../config/providers';
import { logger } from '../logger';
import {
  buildRedirectInstruction,
  buildRefusalLine,
  buildScopeClassifierPrompt,
  detectMessageLanguage,
  parseScopeAnswer,
  type ScopeClassifierPromptInput,
  type ScopeGuardTone,
} from './scope-messaging';

// Re-exported so existing import paths (src/ and tests/) keep working after the
// messaging split into `scope-messaging.ts`.
export {
  buildRedirectInstruction,
  buildRefusalLine,
  buildScopeClassifierPrompt,
  detectMessageLanguage,
  parseScopeAnswer,
};
export type { ScopeClassifierPromptInput, ScopeGuardTone };

/** Plain, import-free description of one domain's boundaries. */
export interface DomainScope {
  domain: string;
  agentName: string;
  /** One line the agent will never answer outside of. */
  scope: string;
  outOfScopeExamples: string[];
  /** Other agents the user can be redirected to (plain data — no cross-domain imports). */
  siblings: Array<{ name: string; description: string }>;
  /** How THIS domain asks for its refusal: tone of voice and how short. Prevails over the env tone. */
  refusal?: { tone?: ScopeGuardTone; maxSentences?: number };
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
  /** Default: redirect unless SCOPE_GUARD_MODE=block (see ScopeGuardMode). */
  mode?: ScopeGuardMode;
  /** Refusal tone; default scope.refusal?.tone ?? SCOPE_GUARD_TONE ?? 'warm'. */
  tone?: ScopeGuardTone;
  /** Refusal length; default scope.refusal?.maxSentences ?? 1 (clamped 1..2). */
  maxSentences?: number;
}

interface MessageLike {
  role?: string;
  content?: { parts?: unknown[] };
}

/** Texto plano de un mensaje (sus partes de texto unidas); '' si no tiene. */
function textOfMessage(message: MessageLike | undefined): string {
  const parts = message?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(
      (part): part is { type: string; text?: string } =>
        typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text'
    )
    .map(part => part.text ?? '')
    .join(' ')
    .trim();
}

/**
 * Índice del último mensaje de usuario **con texto**: es el que el clasificador
 * juzgó y, en modo redirect, el que se reemplaza.
 */
function lastUserTextIndex(messages: MessageLike[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue;
    if (textOfMessage(messages[i]) !== '') return i;
  }
  return -1;
}

function extractLastUserText(messages: MessageLike[]): string {
  const index = lastUserTextIndex(messages);
  return index === -1 ? '' : textOfMessage(messages[index]);
}

/**
 * Sustituye el texto del mensaje clasificado conservando id, rol y formato: el
 * pipeline sigue viendo el mismo mensaje, pero lo que el modelo lee es la
 * instrucción — nunca la petición fuera de alcance.
 */
function replaceClassifiedUserText(messages: MessageLike[], text: string): MessageLike[] {
  const index = lastUserTextIndex(messages);
  if (index === -1) return messages;
  const message = messages[index];
  const content = message?.content;
  if (content === undefined || content === null) return messages;
  const clone = [...messages];
  clone[index] = { ...message, content: { ...content, parts: [{ type: 'text', text }] } };
  return clone;
}

/**
 * Scope enforcement for every domain agent: classifies the last user message and,
 * when it is a SUBSTANTIVE request outside the agent's scope, keeps the
 * specialist from answering it. Two modes (`SCOPE_GUARD_MODE`):
 *
 *  - `redirect` (default): the message text is REPLACED by a controlled, toned
 *    instruction (`buildRedirectInstruction`), so the model answers the refusal
 *    without ever seeing the request.
 *  - `block`: the original hard cut — `abort()` (TripWire before the LLM) with a
 *    short natural refusal line (`buildRefusalLine`).
 *
 * Conversational input, questions about the agent itself and short follow-ups
 * PASS (a chat client opens with a greeting); the exact contract lives in
 * `buildScopeClassifierPrompt()`. Classifier errors fail OPEN; with no provider
 * key the guard is inert by design. Env: SCOPE_GUARD=off, SCOPE_GUARD_MODE,
 * SCOPE_GUARD_MODEL, SCOPE_GUARD_TONE.
 */
export function createScopeGuard(options: ScopeGuardOptions): InputProcessor {
  const {
    domain,
    agentName,
    scope,
    outOfScopeExamples,
    model = guardModel(),
    classify,
    enabled = process.env.SCOPE_GUARD !== 'off',
    mode = readScopeGuardMode(),
  } = options;

  const id = `scope-guard:${domain}`;

  // Tono efectivo: opción explícita > lo que declara el dominio > variable de entorno.
  const tone: ScopeGuardTone = options.tone ?? options.refusal?.tone ?? readScopeGuardTone();
  const maxSentences = options.maxSentences ?? options.refusal?.maxSentences ?? 1;

  let classifierAgent: Agent | undefined;
  const llmClassify = async (text: string): Promise<ScopeVerdict> => {
    classifierAgent ??= new Agent({
      id: `${id}:classifier`,
      name: 'Scope Classifier',
      instructions:
        'You are a topic classifier for one specialist agent. You only label the message — you never answer it.',
      model,
    });
    /**
     * Una sola palabra, y sin JSON a propósito: con un proveedor que no anuncia
     * `supportsStructuredOutputs` (DeepInfra) el esquema de zod no viaja al
     * proveedor, el modelo devolvía otro nombre de campo y la validación lanzaba
     * DENTRO de `generate` → fail-open en CADA turno. El contrato vive en
     * `buildScopeClassifierPrompt()` (probable sin red).
     */
    const prompt = buildScopeClassifierPrompt({ scope, outOfScopeExamples, text });
    const result = await classifierAgent.generate(prompt, { modelSettings: { temperature: 0 } });
    return { inScope: parseScopeAnswer(result.text) };
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

      logger.info(
        `[${id}] out-of-scope input → ${
          mode === 'block' ? 'blocked (TripWire)' : 'redirected (the agent answers the refusal)'
        }, tone: ${tone}`
      );

      const language = detectMessageLanguage(text);

      if (mode === 'block') {
        args.abort(buildRefusalLine({ agentName, scope, tone, language }));
        // abort() throws TripWire at runtime; unreachable, kept for the return contract.
        return args.messages;
      }

      // redirect: el modelo nunca ve la petición — su texto se reemplaza por la
      // instrucción — así que redacta la negativa sin poder responderla.
      return replaceClassifiedUserText(
        args.messages as MessageLike[],
        buildRedirectInstruction({ agentName, scope, tone, language, maxSentences })
      ) as typeof args.messages;
    },
  };
}
