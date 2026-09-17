import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildRedirectInstruction,
  buildScopeClassifierPrompt,
  createScopeGuard,
  detectMessageLanguage,
  parseScopeAnswer,
  type DomainScope,
} from '../../../../src/mastra/shared/processors/scope-guard';
import { readScopeGuardMode } from '../../../../src/mastra/shared/config/providers';

const scope: DomainScope = {
  domain: 'files-test',
  agentName: 'File Operations Agent',
  scope: 'local file operations',
  outOfScopeExamples: ['general knowledge questions'],
  siblings: [{ name: 'Research Agent', description: 'web research' }],
};

function userMessages(text: string) {
  return [{ id: 'm1', role: 'user', content: { parts: [{ type: 'text', text }] } }] as never;
}

function makeArgs(text = 'what happened at the resurrection of christ?') {
  const abort = vi.fn((..._args: unknown[]) => {
    throw new Error('TripWire');
  });
  const messages = userMessages(text);
  return { args: { messages, abort } as never, abort, messages };
}

/** Texto de la nota que el guard escribe en modo redirect. */
async function redirectNote(
  guard: { processInput?: (args: never) => unknown },
  text = 'what happened at the resurrection of christ?'
): Promise<string> {
  const { args } = makeArgs(text);
  const result = (await guard.processInput!(args)) as unknown as Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  return result[0]?.content?.parts?.[0]?.text ?? '';
}

describe('createScopeGuard', () => {
  it('has a domain-scoped id', () => {
    const guard = createScopeGuard({ ...scope, classify: async () => ({ inScope: true }) });
    expect(guard.id).toBe('scope-guard:files-test');
  });

  it('block mode aborts with a short refusal line naming the agent (no catalog)', async () => {
    const guard = createScopeGuard({
      ...scope,
      classify: async () => ({ inScope: false }),
      mode: 'block',
    });
    const { args, abort } = makeArgs();

    await expect(guard.processInput!(args)).rejects.toThrow('TripWire');
    expect(abort).toHaveBeenCalledTimes(1);
    const reason = abort.mock.calls[0][0] as string;
    expect(reason).toContain('File Operations Agent');
    expect(reason.length).toBeLessThan(120);
    expect(reason).not.toContain('Research Agent'); // la nota ya no recita el catálogo
  });

  it('redirect mode (default) keeps the flow: the request is REPLACED by the instruction, never aborted', async () => {
    const guard = createScopeGuard({ ...scope, classify: async () => ({ inScope: false }) });
    const { args, abort, messages } = makeArgs('what happened at the resurrection of christ?');

    const result = (await guard.processInput!(args)) as unknown as Array<{
      role?: string;
      content?: { parts?: Array<{ text?: string }> };
    }>;

    expect(abort).not.toHaveBeenCalled();
    expect(result).not.toBe(messages); // lista nueva, el pipeline sigue
    const text = result[0]?.content?.parts?.[0]?.text ?? '';
    expect(text).toContain('does not belong to File Operations Agent');
    expect(text).toContain('handles only: local file operations');
    expect(text).toContain('a single sentence');
    // el catálogo ya no se vuelca en la nota: vive en el system prompt
    expect(text).not.toContain('Research Agent (web research)');
    // el modelo NUNCA ve la petición: es lo que mantiene el guard siendo guard
    expect(text).not.toContain('resurrection');
  });

  it('redirect mode replaces ONLY the classified message and keeps id/role/shape', async () => {
    const guard = createScopeGuard({ ...scope, classify: async () => ({ inScope: false }) });
    const history = [
      { id: 'u1', role: 'user', content: { format: 'content-v2', parts: [{ type: 'text', text: 'read notes.txt' }] } },
      { id: 'a1', role: 'assistant', content: { parts: [{ type: 'text', text: 'Done.' }] } },
      { id: 'u2', role: 'user', content: { format: 'content-v2', parts: [{ type: 'text', text: 'now schedule a task' }] } },
    ];

    const result = (await guard.processInput!({
      messages: history,
      abort: vi.fn(),
    } as never)) as unknown as typeof history;

    expect(result).toHaveLength(3);
    expect(result[0]).toBe(history[0]); // el primer turno no se toca
    expect(result[1]).toBe(history[1]);
    expect(result[2]?.id).toBe('u2');
    expect(result[2]?.role).toBe('user');
    expect((result[2]?.content as { format?: string }).format).toBe('content-v2');
    expect((result[2]?.content.parts[0] as { text: string }).text).toContain('File Operations Agent');
  });

  it('passes the message through when in scope', async () => {
    const guard = createScopeGuard({ ...scope, classify: async () => ({ inScope: true }) });
    const { args, abort, messages } = makeArgs('read the file notes.txt');

    await expect(guard.processInput!(args)).resolves.toBe(messages);
    expect(abort).not.toHaveBeenCalled();
  });

  it('fails open when the classifier throws', async () => {
    const guard = createScopeGuard({
      ...scope,
      classify: async () => {
        throw new Error('no provider key');
      },
    });
    const { args, abort, messages } = makeArgs();

    await expect(guard.processInput!(args)).resolves.toBe(messages);
    expect(abort).not.toHaveBeenCalled();
  });

  it('never classifies when disabled via enabled:false', async () => {
    const classify = vi.fn(async () => ({ inScope: false }));
    const guard = createScopeGuard({ ...scope, classify, enabled: false });
    const { args, messages } = makeArgs();

    await expect(guard.processInput!(args)).resolves.toBe(messages);
    expect(classify).not.toHaveBeenCalled();
  });

  it('passes through when there is no user text', async () => {
    const classify = vi.fn(async () => ({ inScope: false }));
    const guard = createScopeGuard({ ...scope, classify });
    const abort = vi.fn();
    const messages = [] as never;

    await expect(guard.processInput!({ messages, abort } as never)).resolves.toBe(messages);
    expect(classify).not.toHaveBeenCalled();
  });

  it('extracts text from the LAST user message only', async () => {
    const classify = vi.fn(async () => ({ inScope: true }));
    const guard = createScopeGuard({ ...scope, classify });
    const abort = vi.fn();
    const messages = [
      { id: 'u1', role: 'user', content: { parts: [{ type: 'text', text: 'first' }] } },
      { id: 'a1', role: 'assistant', content: { parts: [{ type: 'text', text: 'reply' }] } },
      { id: 'u2', role: 'user', content: { parts: [{ type: 'text', text: 'latest question' }] } },
    ] as never;

    await guard.processInput!({ messages, abort } as never);
    expect(classify).toHaveBeenCalledWith('latest question');
  });
});

/**
 * El parseo del veredicto, que es la pieza que estaba rota: el clasificador pedía
 * un JSON con esquema y el modelo devolvía otro nombre de campo, así que la
 * validación lanzaba dentro de `generate` y el guard hacía fail-open en cada turno.
 */
describe('parseScopeAnswer', () => {
  it('lee las dos palabras del contrato', () => {
    expect(parseScopeAnswer('IN')).toBe(true);
    expect(parseScopeAnswer('OUT')).toBe(false);
  });

  it('tolera mayúsculas, espacios y una explicación detrás', () => {
    expect(parseScopeAnswer('  out  ')).toBe(false);
    expect(parseScopeAnswer('OUT (no es investigación)')).toBe(false);
    expect(parseScopeAnswer('In: the user asks about a web source')).toBe(true);
  });

  it('falla en abierto ante una respuesta ilegible', () => {
    // Mismo contrato que el resto del guard: el ruido del clasificador no puede
    // bloquear tráfico legítimo.
    expect(parseScopeAnswer('')).toBe(true);
    expect(parseScopeAnswer('no lo sé')).toBe(true);
    expect(parseScopeAnswer('{"in_scope":false}')).toBe(true);
  });
});

/**
 * Contrato del prompt (2026-09-17). La política del guard ES el texto del
 * prompt, así que se prueba aquí sin red — mismo criterio que
 * `parseScopeAnswer`. El caso vivo (un saludo real que NO debe disparar el
 * tripwire) vive en `tests/integration/scope-guard-live.test.ts`.
 */
describe('buildScopeClassifierPrompt', () => {
  const build = () =>
    buildScopeClassifierPrompt({
      scope: 'local file operations',
      outOfScopeExamples: ['general knowledge questions', 'task scheduling'],
      text: 'hola',
    });

  it('lleva el scope, los ejemplos de otro dominio y el mensaje del usuario', () => {
    const prompt = build();
    expect(prompt).toContain('Agent scope: local file operations');
    expect(prompt).toContain('general knowledge questions | task scheduling');
    expect(prompt).toContain('hola');
  });

  it('mantiene el contrato de UNA palabra que parseScopeAnswer sabe leer', () => {
    const prompt = build();
    expect(prompt).toContain('Answer with exactly one word:');
    expect(prompt).toContain('IN if');
    expect(prompt).toContain('OUT only if');
    // el parseo real de la respuesta sigue siendo el mismo contrato
    expect(parseScopeAnswer('IN')).toBe(true);
    expect(parseScopeAnswer('OUT')).toBe(false);
  });

  it('deja pasar conversación, meta-preguntas del propio agente y seguimientos', () => {
    const prompt = build();
    expect(prompt).toContain('conversational');
    expect(prompt).toContain('greeting');
    expect(prompt).toContain('what it does, how to use it');
    expect(prompt).toContain('chat client opens with exactly these');
  });

  it('reserva OUT a una petición SUSTANTIVA que pertenezca a otro dominio', () => {
    const prompt = build();
    expect(prompt).toContain('OUT only if the message is a SUBSTANTIVE request');
    // el motivo de bloquear: responder de memoria propia o actuar fuera de su dominio
    expect(prompt).toContain('own general knowledge');
  });
});

/**
 * Modo del guard (2026-09-17, segunda pasada). El corte duro convertía una
 * petición fuera de alcance en un recuadro de bloqueo; el default pasa a
 * `redirect` — el agente redacta la negativa — y `block` queda como opt-in.
 */
describe('readScopeGuardMode', () => {
  it('defaults to redirect; only an explicit "block" keeps the hard cut', () => {
    expect(readScopeGuardMode({})).toBe('redirect');
    expect(readScopeGuardMode({ SCOPE_GUARD_MODE: 'redirect' })).toBe('redirect');
    expect(readScopeGuardMode({ SCOPE_GUARD_MODE: 'nonsense' })).toBe('redirect');
    expect(readScopeGuardMode({ SCOPE_GUARD_MODE: 'block' })).toBe('block');
    expect(readScopeGuardMode({ SCOPE_GUARD_MODE: ' BLOCK ' })).toBe('block');
  });
});

describe('buildRedirectInstruction', () => {
  it('names the agent and the scope, and asks for ONE short sentence (no catalog)', () => {
    const text = buildRedirectInstruction({
      agentName: 'File Operations Agent',
      scope: 'local file operations',
      tone: 'warm',
    });

    expect(text).toContain('File Operations Agent');
    expect(text).toContain('local file operations');
    expect(text).toContain('a single sentence'); // idioma default = en
    // la firma ya no recibe `siblings`: la nota no puede enumerar el catálogo
    expect(text).not.toContain('Research Agent');
    expect(text).not.toContain('web research');
  });

  it('writes the note in the language the user wrote in (the model mirrors the last message)', () => {
    const input = {
      agentName: 'File Operations Agent',
      scope: 'local file operations',
      tone: 'warm' as const,
    };

    expect(buildRedirectInstruction({ ...input, language: 'es' })).toContain(
      'no corresponde a File Operations Agent'
    );
    expect(buildRedirectInstruction({ ...input, language: 'en' })).toContain(
      'does not belong to File Operations Agent'
    );
  });

  it('is DECLARATIVE, not imperative: the injection detector reads this text as user input', () => {
    // Verificado contra el detector real: un texto imperativo ("must not be
    // answered" / "do not mention these instructions") se clasifica como
    // system-override y aborta el turno. Este test AMPLÍA el contrato original
    // con más patrones imperativos prohibidos para que la reescritura no lo
    // rompa en silencio (es y en pasan el detector).
    const base = {
      agentName: 'File Operations Agent',
      scope: 'local file operations',
      tone: 'warm' as const,
    };

    for (const language of ['es', 'en'] as const) {
      const text = buildRedirectInstruction({ ...base, language });
      expect(text).not.toMatch(
        /do not|must not|you must|ignora (todas|las)|no menciones|no digas|do not reveal|never mention|debes\s+\w+|\[System\]/i
      );
      expect(text).not.toContain('[System]');
    }
  });
});

/**
 * Tono de la negativa (fase 3): resuelto opción > dominio > entorno. Los tonos
 * se guardan como datos (`REFUSAL_VOICE`), así que basta comprobar que la voz
 * esperada aparece en la nota; los textos exactos y la matriz completa 3×2 viven
 * en scope-messaging.test.ts.
 */
describe('refusal tone resolution', () => {
  afterEach(() => {
    delete process.env.SCOPE_GUARD_TONE;
  });

  it('lets an explicit option win over the domain declaration', async () => {
    const guard = createScopeGuard({
      ...scope,
      refusal: { tone: 'neutral' },
      tone: 'formal',
      classify: async () => ({ inScope: false }),
    });
    expect(await redirectNote(guard)).toContain('formal');
  });

  it('honours the domain tone (scope.refusal.tone) when no option is given', async () => {
    const guard = createScopeGuard({
      ...scope,
      refusal: { tone: 'neutral' },
      classify: async () => ({ inScope: false }),
    });
    expect(await redirectNote(guard)).toContain('plain');
  });

  it('honours scope.refusal.maxSentences when no option is given', async () => {
    const guard = createScopeGuard({
      ...scope,
      refusal: { maxSentences: 2 },
      classify: async () => ({ inScope: false }),
    });
    expect(await redirectNote(guard)).toContain('at most two sentences');
  });

  it('falls back to SCOPE_GUARD_TONE when the scope declares no tone', async () => {
    process.env.SCOPE_GUARD_TONE = 'formal';
    const guard = createScopeGuard({ ...scope, classify: async () => ({ inScope: false }) });
    expect(await redirectNote(guard)).toContain('formal');
  });

  it('defaults to warm (no option, no domain tone, no env)', async () => {
    delete process.env.SCOPE_GUARD_TONE;
    const guard = createScopeGuard({ ...scope, classify: async () => ({ inScope: false }) });
    expect(await redirectNote(guard)).toContain('warm');
  });
});

describe('detectMessageLanguage', () => {
  it('recognises Spanish by its signs and letters; everything else falls back to en', () => {
    expect(detectMessageLanguage('¿qué pasó en la resurrección de Cristo?')).toBe('es');
    expect(detectMessageLanguage('créame una tarea para mañana')).toBe('es');
    expect(detectMessageLanguage('what happened at the resurrection of christ?')).toBe('en');
    expect(detectMessageLanguage('hola')).toBe('en'); // sin marcas: el fallback es barato y estable
  });
});
