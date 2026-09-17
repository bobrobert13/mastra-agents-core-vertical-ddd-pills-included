/**
 * Scope-guard MESSAGING — a pure, import-light module (no processors, no
 * network, no `Agent`): everything here is provable offline. It splits the
 * "what the guard says" concern out of `scope-guard.ts`, which keeps only the
 * processor mechanics (message surgery, classification, the two modes).
 *
 * Two deliverables live here:
 *  - the CLASSIFIER contract (`buildScopeClassifierPrompt` / `parseScopeAnswer`),
 *    which decides in/out-of-scope, and
 *  - the user-facing COPY: the redirect note (mode `redirect`) and the short
 *    refusal line (mode `block`), both toned and mirrored in the user language.
 *
 * The whole user-facing copy is DECLARATIVE on purpose: the injection detector
 * runs AFTER the guard and reads the redirect note as if the user had written
 * it, so an imperative note ("must not", "do not mention these instructions")
 * is classified as `system-override` and aborts the turn — a false positive of
 * our own guardrail, reproduced against the real detector. If any copy below is
 * rewritten, re-run it against the detector (see the offline anti-imperative
 * tests in `tests/unit/shared/processors/scope-messaging.test.ts`).
 */

/** How the refusal is voiced. Data, not `if` branches (see `REFUSAL_VOICE`). */
export type ScopeGuardTone = 'warm' | 'formal' | 'neutral';

/** Voice description per tone and language, woven into the redirect note. */
export const REFUSAL_VOICE: Record<ScopeGuardTone, { es: string; en: string }> = {
  warm: { es: 'cálida y cercana', en: 'warm and friendly' },
  formal: { es: 'formal y respetuosa', en: 'formal and courteous' },
  neutral: { es: 'sobria y directa', en: 'plain and matter-of-fact' },
};

/** Sentence-count phrasing ("one sentence" / "at most two") per tone language. */
const SENTENCE_COUNT: Record<'es' | 'en', Record<1 | 2, string>> = {
  es: { 1: 'una sola frase', 2: 'como mucho dos frases' },
  en: { 1: 'a single sentence', 2: 'at most two sentences' },
};

/** Refusal line (mode `block`) per tone and language; `{agent}` is interpolated. */
const REFUSAL_LINE: Record<ScopeGuardTone, { es: string; en: string }> = {
  warm: {
    es: 'Disculpa, esto no es algo que {agent} pueda atender.',
    en: 'Sorry, this is not something {agent} can help with.',
  },
  formal: {
    es: 'Lamento informarle de que esta consulta queda fuera del ámbito de {agent}.',
    en: 'I regret to inform you that this request falls outside the scope of {agent}.',
  },
  neutral: {
    es: 'Esta consulta queda fuera de lo que atiende {agent}.',
    en: 'This request is outside what {agent} handles.',
  },
};

/**
 * Idioma del mensaje clasificado, por la vía barata: los signos y letras que el
 * español usa y el inglés no. No es un detector de idioma — es lo suficiente
 * para redactar la nota en el idioma en el que el usuario escribió, que es lo
 * que mantiene la respuesta final en su idioma (el modelo sigue el idioma del
 * último mensaje, y el último mensaje pasa a ser la nota).
 */
export function detectMessageLanguage(text: string): 'es' | 'en' {
  return /[¿¡ñáéíóúü]/i.test(text) ? 'es' : 'en';
}

/** Clamp of `maxSentences`: default 1, never outside 1..2. */
function normalizeMaxSentences(value?: number): 1 | 2 {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(2, Math.max(1, Math.round(value))) as 1 | 2;
}

/**
 * Instrucción con la que se REEMPLAZA el mensaje fuera de alcance (modo redirect).
 *
 * El punto que la hace segura: el modelo **nunca ve la petición** — su texto se
 * sustituye por esta instrucción — así que no puede responderla desde su
 * conocimiento general (el incidente que motivó el guard) y aun así produce una
 * respuesta conversacional en vez de un corte. La negativa concreta la redacta
 * el agente siguiendo su "Refusal protocol" (`scopedInstructions`).
 *
 * Ya NO vuelca el catálogo de hermanos: vive en el system prompt
 * (`scopedInstructions`), así que la nota solo pide, si acaso, nombrar como
 * máximo UN agente que encaje. Es corta (una frase, o dos) y declara el tono y
 * el idioma esperados. Declarativa a propósito (ver cabecera del módulo).
 */
export function buildRedirectInstruction(input: {
  agentName: string;
  scope: string;
  tone: ScopeGuardTone;
  language?: 'es' | 'en';
  maxSentences?: number; // default 1, clamp 1..2
}): string {
  const language = input.language === 'es' ? 'es' : 'en';
  const tone = input.tone ?? 'warm';
  const voice = (REFUSAL_VOICE[tone] ?? REFUSAL_VOICE.warm)[language];
  const sentences = SENTENCE_COUNT[language][normalizeMaxSentences(input.maxSentences)];

  if (language === 'es') {
    return [
      `Nota: la petición anterior no corresponde a ${input.agentName} y se retiró de la conversación.`,
      `${input.agentName} atiende únicamente: ${input.scope}.`,
      `El usuario espera una respuesta ${voice}, de ${sentences}, en su idioma: que esa petición no se puede atender aquí.`,
      'Si un agente del catálogo encaja claramente con lo pedido, se puede nombrar a lo sumo uno dentro de esa misma respuesta; si no encaja ninguno, no se nombra a nadie.',
    ].join(' ');
  }
  return [
    `Note: the previous request does not belong to ${input.agentName} and was removed from the conversation.`,
    `${input.agentName} handles only: ${input.scope}.`,
    `The user is waiting for a ${voice} reply, of ${sentences}, in their own language: that this request cannot be handled here.`,
    'If one agent from the catalog clearly fits what was asked, at most one may be named inside that same reply; if none fits, no agent is named.',
  ].join(' ');
}

/**
 * Frase de negativa para el modo `block`: corta, natural y para el cliente (el
 * `abort()` la muestra como TripWire). Una sola frase, en el idioma detectado y
 * con el registro del tono pedido — el registro cambia, la longitud no.
 */
export function buildRefusalLine(input: {
  agentName: string;
  scope: string;
  tone: ScopeGuardTone;
  language?: 'es' | 'en';
}): string {
  const language = input.language === 'es' ? 'es' : 'en';
  const tone = input.tone ?? 'warm';
  const template = (REFUSAL_LINE[tone] ?? REFUSAL_LINE.warm)[language];
  return template.replace('{agent}', input.agentName);
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
