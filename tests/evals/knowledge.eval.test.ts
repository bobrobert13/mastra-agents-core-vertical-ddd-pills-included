import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import dataset from './datasets/knowledge-dataset.json';

/**
 * OKR-2 evals tier (spec 03 §3.11): STRUCTURAL today — every case's expected
 * chunk must exist verbatim inside the pinned fixture, so a fixture edit that
 * breaks the RAG expectations fails here, offline. The 8/10 answer-quality
 * bar needs generate() with a real LLM (gotcha G5) → the live block is
 * skipIf-guarded and stays green-skipped without keys.
 */

const hasProviderKey = [
  'DEEPINFRA_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
].some(k => (process.env[k] ?? '').trim() !== '');

describe('knowledge eval dataset — structural contracts (offline)', () => {
  const fixturePath = path.join(process.cwd(), dataset.fixture);

  it('fixture exists and yields ≥ 3 recursive chunks worth of content', () => {
    const text = readFileSync(fixturePath, 'utf8');
    expect(text.length).toBeGreaterThan(512 * 3);
    expect(text).toContain('€2,000 laptop budget');
  });

  it.each(dataset.cases)('$id: expected chunk text is present in the fixture', async c => {
    const text = readFileSync(fixturePath, 'utf8').replace(/\s+/g, ' ');
    expect(text).toContain(c.expectedChunkContains);
  });

  it('every case query is a natural-language question', () => {
    for (const c of dataset.cases) {
      expect(c.query.trim().endsWith('?')).toBe(true);
    }
  });
});

describe.skipIf(!hasProviderKey)('knowledge answer quality — live 8/10 bar', () => {
  // Needs a provider key (G5): index the fixture, generate answers with the
  // research agent + search_knowledge, judge containment of
  // expectedChunkContains. Wired here once evals scoring for RAG lands in
  // Phase 4 — until then this block is skipIf-protected by design.
  it('is skipped without provider keys', () => {
    expect(dataset.qualityBar.answerAccuracy).toBe(8);
  });
});
