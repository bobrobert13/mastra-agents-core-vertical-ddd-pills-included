import { describe, it, expect, vi } from 'vitest';
import {
  buildScopeClassifierPrompt,
  createScopeGuard,
  parseScopeAnswer,
  type DomainScope,
} from '../../../../src/mastra/shared/processors/scope-guard';

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

describe('createScopeGuard', () => {
  it('has a domain-scoped id', () => {
    const guard = createScopeGuard({ ...scope, classify: async () => ({ inScope: true }) });
    expect(guard.id).toBe('scope-guard:files-test');
  });

  it('aborts with agent name and sibling redirect when out of scope', async () => {
    const guard = createScopeGuard({ ...scope, classify: async () => ({ inScope: false }) });
    const { args, abort } = makeArgs();

    await expect(guard.processInput!(args)).rejects.toThrow('TripWire');
    expect(abort).toHaveBeenCalledTimes(1);
    const reason = abort.mock.calls[0][0] as string;
    expect(reason).toContain('File Operations Agent only handles');
    expect(reason).toContain('Research Agent');
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
