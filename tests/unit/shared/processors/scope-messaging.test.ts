import { describe, it, expect } from 'vitest';
import {
  buildRedirectInstruction,
  buildRefusalLine,
  REFUSAL_VOICE,
  type ScopeGuardTone,
} from '../../../../src/mastra/shared/processors/scope-messaging';

const TONES: ScopeGuardTone[] = ['warm', 'formal', 'neutral'];
const LANGS = ['es', 'en'] as const;

/**
 * Anti-imperativo (ampliado respecto al contrato original): el detector de
 * inyección corre DESPUÉS del guard y lee la nota como si la hubiera escrito el
 * usuario, así que un texto imperativo se clasifica como `system-override` y
 * aborta el turno. Este regex fija que la nota siga siendo declarativa.
 */
const IMPERATIVE =
  /do not|must not|you must|ignora (todas|las)|no menciones|no digas|do not reveal|never mention|debes\s+\w+|\[System\]/i;

const base = { agentName: 'File Operations Agent', scope: 'local file operations' };

describe('buildRedirectInstruction', () => {
  it.each(TONES.flatMap(tone => LANGS.map(language => [tone, language] as const)))(
    'names the agent and scope and asks for ONE sentence — %s/%s',
    (tone, language) => {
      const text = buildRedirectInstruction({ ...base, tone, language });

      expect(text).toContain('File Operations Agent');
      expect(text).toContain('local file operations');
      expect(text).toContain(language === 'es' ? 'una sola frase' : 'a single sentence');
      expect(text).toContain(REFUSAL_VOICE[tone][language]);
    }
  );

  it.each(TONES.flatMap(tone => LANGS.map(language => [tone, language] as const)))(
    'is DECLARATIVE and never dumps the sibling catalog — %s/%s',
    (tone, language) => {
      const text = buildRedirectInstruction({ ...base, tone, language });

      expect(text).not.toMatch(IMPERATIVE);
      expect(text).not.toContain('[System]');
      // la firma ya no recibe `siblings`: no puede enumerar descripciones de hermanos
      expect(text).not.toContain('Research Agent');
      expect(text).not.toContain('web research');
    }
  );

  it('writes Spanish and English differently', () => {
    const es = buildRedirectInstruction({ ...base, tone: 'warm', language: 'es' });
    const en = buildRedirectInstruction({ ...base, tone: 'warm', language: 'en' });

    expect(es).not.toBe(en);
    expect(es).toContain('no corresponde a File Operations Agent');
    expect(en).toContain('does not belong to File Operations Agent');
  });

  it('asks for two sentences at most when maxSentences is 2', () => {
    expect(buildRedirectInstruction({ ...base, tone: 'warm', language: 'es', maxSentences: 2 })).toContain(
      'como mucho dos frases'
    );
    expect(buildRedirectInstruction({ ...base, tone: 'warm', language: 'en', maxSentences: 2 })).toContain(
      'at most two sentences'
    );
  });

  it('clamps maxSentences to the 1..2 range', () => {
    const one = buildRedirectInstruction({ ...base, tone: 'warm', language: 'en' });
    expect(buildRedirectInstruction({ ...base, tone: 'warm', language: 'en', maxSentences: 9 })).toContain(
      'at most two sentences'
    );
    expect(buildRedirectInstruction({ ...base, tone: 'warm', language: 'en', maxSentences: 0 })).toBe(one);
  });

  it('falls back to English for an unknown language', () => {
    const en = buildRedirectInstruction({ ...base, tone: 'formal', language: 'en' });
    const unknown = buildRedirectInstruction({
      ...base,
      tone: 'formal',
      language: 'de' as unknown as 'en',
    });

    expect(unknown).toBe(en);
  });
});

describe('buildRefusalLine', () => {
  it.each(TONES.flatMap(tone => LANGS.map(language => [tone, language] as const)))(
    'is one short sentence naming the agent — %s/%s',
    (tone, language) => {
      const line = buildRefusalLine({ ...base, tone, language });

      expect(line).toContain('File Operations Agent');
      expect(line.length).toBeLessThanOrEqual(120);
      expect(line).not.toContain('\n');
    }
  );

  it('matches the target requirement literally for warm/es and warm/en', () => {
    expect(buildRefusalLine({ ...base, tone: 'warm', language: 'es' })).toBe(
      'Disculpa, esto no es algo que File Operations Agent pueda atender.'
    );
    expect(buildRefusalLine({ ...base, tone: 'warm', language: 'en' })).toBe(
      'Sorry, this is not something File Operations Agent can help with.'
    );
  });

  it('varies the register with tone and language (no two lines alike)', () => {
    const lines = TONES.flatMap(tone => LANGS.map(language => buildRefusalLine({ ...base, tone, language })));
    expect(new Set(lines).size).toBe(TONES.length * LANGS.length);
  });

  it('falls back to English for an unknown language', () => {
    expect(buildRefusalLine({ ...base, tone: 'warm', language: 'fr' as unknown as 'en' })).toBe(
      buildRefusalLine({ ...base, tone: 'warm', language: 'en' })
    );
  });
});
