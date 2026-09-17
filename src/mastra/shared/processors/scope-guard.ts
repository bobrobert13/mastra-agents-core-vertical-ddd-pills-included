import { Agent } from '@mastra/core/agent';
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

/**
 * Traduce la respuesta del clasificador a un veredicto.
 *
 * Exportada a propósito: es la pieza que estaba rota (el modelo devolvía un nombre
 * de campo distinto y la validación lanzaba), y así se prueba sin red.
 *
 * Ante la duda devuelve `inScope: true` — el mismo fail-open del resto del guard:
 * un clasificador ilegible no puede bloquear tráfico legítimo.
 */
export function parseScopeAnswer(text: string): boolean {
  // `startsWith` y no igualdad: un modelo locuaz contesta "OUT (no es investigación)".
  return !text.trim().toUpperCase().startsWith('OUT');
}

export interface ScopeGuardOptions extends DomainScope {
  /** Classifier model id; default guardModel(). */
  model?: string;
  /** Injectable classifier (offline tests); default uses an internal provider-agnostic Agent. */
  classify?: (text: string) => Promise<ScopeVerdict>;
  /** Default: on unless SCOPE_GUARD=off. */
  enabled?: boolean;
}

/** Inputs of the classifier prompt (exported for the offline prompt-contract test). */
export interface ScopeClassifierPromptInput {
  scope: string;
  outOfScopeExamples: string[];
  text: string;
}

/**
 * Prompt del clasificador. Exportado para poder probar el CONTRATO sin red —
 * misma razón que `parseScopeAnswer`.
 *
 * Política (2026-09-17, incidente real: un cliente de chat recibía el tripwire
 * al escribir "hola" en `chat/nuevo`). El prompt anterior —"strict topic
 * classifier", con las preguntas de cultura general en la lista de fuera de
 * alcance— mandaba a OUT CUALQUIER mensaje que no fuese una petición de trabajo:
 * el saludo de apertura, un "gracias", un "¿qué puedes hacer?" o el seguimiento
 * corto de una conversación en curso. Desde el cliente eso se ve como un chat
 * roto, no como un guardarraíl.
 *
 * Contrato vigente: conversación, meta-preguntas del propio agente y
 * seguimientos pasan; OUT queda reservado a una petición SUSTANTIVA que
 * pertenezca a otro dominio (el agente tendría que responderla de su propia
 * memoria o ejecutar una acción que no es suya).
 */
export function buildScopeClassifierPrompt(input: ScopeClassifierPromptInput): string {
  return [
    `Agent scope: ${input.scope}`,
    `Substantive requests that belong to ANOTHER domain: ${input.outOfScopeExamples.join(' | ')}`,
    '',
    `User message:`,
    input.text,
    '',
    'Answer with exactly one word:',
    'IN if the message is within scope, OR it is conversational (a greeting, thanks, an acknowledgement), OR it asks about this agent itself (what it does, how to use it) — a chat client opens with exactly these.',
    'OUT only if the message is a SUBSTANTIVE request that belongs to another domain, i.e. this agent would have to answer it from its own general knowledge or take an action it does not own.',
  ].join('\n');
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
 * message and aborts (TripWire, before the LLM runs) when it is a SUBSTANTIVE
 * request outside the agent's scope — so a specialist never answers off-topic
 * from model knowledge and never tool-calls on hallucinated input.
 *
 * Conversational input (greetings, thanks, acknowledgements), questions about
 * the agent itself and short follow-ups of an in-scope request PASS: a client
 * chat opens with a greeting, and blocking that reads as a broken product
 * (2026-09-17 incident). The exact contract lives in
 * `buildScopeClassifierPrompt()`.
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
        'You are a topic classifier for one specialist agent. You only label the message — you never answer it.',
      model,
    });
    /**
     * Una sola palabra, y sin JSON a propósito.
     *
     * El clasificador pedía antes `structuredOutput: z.object({ inScope: boolean })`.
     * Con un proveedor que **no** anuncia `supportsStructuredOutputs` —DeepInfra
     * entre ellos— el esquema no viaja al proveedor: Mastra lo inyecta en el prompt
     * y queda a merced del modelo. DeepSeek devolvía `{"in_scope": …}` (snake_case),
     * la validación de zod lanzaba DENTRO de `generate`, y el guard hacía fail-open
     * en CADA turno: se pagaba la llamada y no se clasificaba nada.
     *
     * El texto del contrato vive en `buildScopeClassifierPrompt()` (arriba) para
     * que la política sea probable sin red.
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

      const redirect = siblings.map(s => `${s.name} (${s.description})`).join('; ');
      args.abort(
        `${agentName} only handles ${scope}. Your message appears unrelated to this agent's scope. Try instead: ${redirect}.`
      );
      // abort() throws TripWire at runtime; unreachable, kept for the return contract.
      return args.messages;
    },
  };
}
