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
 * file read). The scope guard must TripWire that input before the LLM runs.
 * Skipped (not failed) without a provider key: the guard fails open there.
 *
 * Second regression (2026-09-17): the Astro chat client was TripWired on the
 * FIRST message of a new thread — a greeting — so the user saw the scope notice
 * instead of a reply. Conversational input and questions about the agent itself
 * must reach the model; only substantive cross-domain requests are OUT.
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
  it('aborts an off-topic question with a redirect instead of answering', async () => {
    const result = await generate('¿qué pasó en la resurrección de Cristo?', `off-topic-${Date.now()}`);

    expect(result.text).toBe('');
    expect(result.tripwire).toBeDefined();
    expect(String(result.tripwire?.reason)).toContain('File Operations Agent only handles');
    expect(String(result.tripwire?.reason)).toContain('Research Agent');
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

  it('still blocks a substantive request owned by another domain', async () => {
    const result = await generate('créame una tarea para revisar el informe mañana', `cross-domain-${Date.now()}`);

    expect(result.text).toBe('');
    expect(result.tripwire).toBeDefined();
    expect(String(result.tripwire?.reason)).toContain('Task Management Agent');
  }, 120_000);
});
