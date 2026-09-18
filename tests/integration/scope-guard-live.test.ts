import { describe, it, expect } from 'vitest';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';

import { fileOperationsAgent } from '../../src/mastra/domains/file-operations';
import { VECTOR_STORE_NAME } from '../../src/mastra/shared/config/vectors';

const hasProviderKey = [
  'DEEPINFRA_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
].some(key => process.env[key]?.trim());

/**
 * Regression for the real incident: the file-operations agent answered an
 * off-topic general-knowledge question from model memory (and hallucinated a
 * file read). The scope guard must keep that input from being answered.
 * Skipped (not failed) without a provider key: the guard fails open there.
 *
 * Second regression (2026-09-17): the Astro chat client was TripWired on the
 * FIRST message of a new thread — a greeting — so the user saw the scope notice
 * instead of a reply. Conversational input and questions about the agent itself
 * must reach the model; only substantive cross-domain requests are OUT.
 *
 * Third regression (2026-09-17, second pass): a hard cut (TripWire) turned an
 * out-of-scope request into an amber block notice instead of a reply. The
 * default mode is now `redirect`: the request text is REPLACED by a controlled
 * instruction, so the AGENT answers the refusal without ever seeing the request
 * (`SCOPE_GUARD_MODE=block` restores the hard cut; that path is covered
 * offline in tests/unit/shared/processors/scope-guard.test.ts).
 *
 * Fourth regression (2026-09-18, guard ORDER): the scope guard's redirect note
 * was then re-scanned by the injection detector (which ran AFTER it) and its
 * classifier killed the turn with a TripWire on a perfectly harmless out-of-scope
 * question. The order rule now puts raw-input scanners first and the scope guard
 * last; the same-thread case below is the end-to-end guard for that incident.
 *
 * The agent runs through a minimal Mastra harness: Memory needs the instance's
 * storage + vector store, and a bare domain agent has neither (the real
 * `/chat/:agentId` path always goes through the composition root).
 */
const harness = new Mastra({
  agents: { files: fileOperationsAgent },
  storage: new LibSQLStore({ id: 'scope-guard-live-storage', url: 'file::memory:' }),
  vectors: {
    [VECTOR_STORE_NAME]: new LibSQLVector({ id: VECTOR_STORE_NAME, url: 'file::memory:' }),
  },
});

const filesAgent = harness.getAgent('files');

function generate(message: string, thread: string) {
  return filesAgent.generate(message, {
    memory: { thread, resource: 'scope-guard-live-test' },
  });
}

describe.skipIf(!hasProviderKey)('scope guard live enforcement', () => {
  it('redirects an off-topic question: the agent answers the refusal, no TripWire', async () => {
    const result = await generate('¿qué pasó en la resurrección de Cristo?', `off-topic-${Date.now()}`);

    // El flujo no se corta: hay respuesta del agente y no hay tripwire.
    expect(result.tripwire).toBeUndefined();
    expect(result.text.trim().length).toBeGreaterThan(0);
    // La alternativa concreta ya NO está garantizada: el catálogo de hermanos
    // dejó de inyectarse en la nota (fase 3), así que solo exigimos una negativa
    // breve y natural — una frase, sin volcar la lista de agentes.
    expect(result.text.length).toBeLessThan(400);
    const named = ['Research Agent', 'Task Management Agent', 'Communication Agent'].filter(name =>
      result.text.includes(name)
    );
    expect(named.length).toBeLessThanOrEqual(1);
  }, 120_000);

  it.each(['hola', '¿qué puedes hacer?'])(
    'lets a new thread open normally: %s',
    async message => {
      const result = await generate(message, `conversational-${encodeURIComponent(message)}`);

      expect(result.tripwire).toBeUndefined();
      expect(result.text.trim().length).toBeGreaterThan(0);
    },
    120_000
  );

  it('also redirects a substantive request owned by another domain', async () => {
    const result = await generate('créame una tarea para revisar el informe mañana', `cross-domain-${Date.now()}`);

    expect(result.tripwire).toBeUndefined();
    expect(result.text.trim().length).toBeGreaterThan(0);
    // Igual que arriba: sin el catálogo en la nota, la alternativa concreta no se
    // garantiza — pedimos una negativa breve (fase 3), no el nombre del hermano.
    expect(result.text.length).toBeLessThan(400);
  }, 120_000);

  it('incident 2026-09-18: greeting then out-of-scope in the SAME thread never trips the guards', async () => {
    const thread = `incident-order-${Date.now()}`;

    const greeting = await generate('hola', thread);
    expect(greeting.tripwire).toBeUndefined();
    expect(greeting.text.trim().length).toBeGreaterThan(0);

    // La nota del redirect del scope guard la escribía ANTES el guard y la
    // re-escaneaba el detector de inyección (que corría detrás) → TripWire.
    const offTopic = await generate('¿qué pasó en la resurrección de Cristo?', thread);
    expect(offTopic.tripwire).toBeUndefined();
    expect(offTopic.text.trim().length).toBeGreaterThan(0);
    expect(offTopic.text.length).toBeLessThan(400);
  }, 180_000);
});
