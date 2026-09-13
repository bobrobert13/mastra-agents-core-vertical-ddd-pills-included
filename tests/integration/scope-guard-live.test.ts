import { describe, it, expect } from 'vitest';
import { fileOperationsAgent } from '../../src/mastra/domains/file-operations';

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
 */
describe.skipIf(!hasProviderKey)('scope guard live enforcement', () => {
  it('aborts an off-topic question with a redirect instead of answering', async () => {
    const result = await fileOperationsAgent.generate('¿qué pasó en la resurrección de Cristo?', {
      memory: {
        thread: `scope-guard-live-${Date.now()}`,
        resource: 'scope-guard-live-test',
      },
    });

    expect(result.text).toBe('');
    expect(result.tripwire).toBeDefined();
    expect(String(result.tripwire?.reason)).toContain('File Operations Agent only handles');
    expect(String(result.tripwire?.reason)).toContain('Research Agent');
  }, 120_000);
});
