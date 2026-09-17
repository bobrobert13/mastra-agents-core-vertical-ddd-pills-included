import { afterEach, describe, expect, it } from 'vitest';

// PURE module only — this file must never transitively load @mastra/core/llm
// or @mastra/fastembed (spec 03 amendment: the unit tier tests it offline).
import {
  EMBEDDING_CONFIG_ENV,
  EMBEDDING_CONFIG_EXPECTED_SHAPE,
  parseEmbeddingConfig,
} from '../../../../src/mastra/shared/config/embedding-parse';

const SUFFIX =
  'Unset the variable to use EMBEDDING_MODEL or the local fastembed default; see .env.example.';

const prefix = '[Embeddings] Invalid EMBEDDING_CONFIG:';

const savedEnv: Record<string, string | undefined> = {};

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  for (const key of Object.keys(vars)) {
    savedEnv[key] ??= process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
}

afterEach(() => {
  delete process.env.EMBED_TEST_KEY;
  delete process.env.EMBED_MISSING_VAR;
});

describe('parseEmbeddingConfig — unset = legal (golden rule)', () => {
  it('undefined → undefined', () => {
    expect(parseEmbeddingConfig(undefined)).toBeUndefined();
  });

  it('empty and whitespace-only strings count as unset', () => {
    expect(parseEmbeddingConfig('')).toBeUndefined();
    expect(parseEmbeddingConfig('   ')).toBeUndefined();
  });
});

describe('parseEmbeddingConfig — set-but-invalid throws the [Embeddings] family', () => {
  const expectInvalid = (raw: string, ...fragments: string[]) => {
    let thrown: Error | undefined;
    try {
      parseEmbeddingConfig(raw);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, `expected "${raw}" to throw`).toBeDefined();
    expect(thrown!.message).toContain(prefix);
    expect(thrown!.message).toContain(SUFFIX);
    for (const fragment of fragments) expect(thrown!.message).toContain(fragment);
  };

  it('malformed JSON names the parse failure', () => {
    expectInvalid('{not json}', 'JSON parse failed');
  });

  it('null / array / scalar are not a config object', () => {
    expectInvalid('null', 'got null');
    expectInvalid('[{"id":"openai/x"}]', 'got an array');
    expectInvalid('"openai/x"', 'got string');
  });

  it('both id and providerId+modelId is ambiguous', () => {
    expectInvalid(
      '{"id":"openai/text-embedding-3-small","providerId":"openai","modelId":"text-embedding-3-small"}',
      'not both'
    );
  });

  it('providerId without modelId (and vice versa) is incomplete', () => {
    expectInvalid('{"providerId":"openai"}', 'must be provided together');
  });

  it('neither id nor providerId+modelId is required', () => {
    expectInvalid('{"dimension":1536}', 'exactly one of');
  });

  it('unknown keys are rejected (.strict())', () => {
    expectInvalid('{"providerId":"openai","modelId":"m","dimmension":1024}', "'dimmension'");
  });

  it('id must be provider/model', () => {
    expectInvalid('{"id":"text-embedding-3-small"}', '"id"');
  });

  it('dimension must be a positive integer', () => {
    expectInvalid('{"providerId":"openai","modelId":"m","dimension":0}', '"dimension"');
    expectInvalid('{"providerId":"openai","modelId":"m","dimension":-1}', '"dimension"');
    expectInvalid('{"providerId":"openai","modelId":"m","dimension":1.5}', '"dimension"');
  });

  it('url must be an absolute http(s) URL (checked AFTER interpolation)', () => {
    expectInvalid('{"providerId":"openai","modelId":"m","url":"not-a-url"}', 'absolute URL');
    expectInvalid('{"providerId":"openai","modelId":"m","url":"ftp://host/v1"}', 'unsupported protocol');
  });

  it('headers must map strings to strings', () => {
    expectInvalid(
      '{"providerId":"openai","modelId":"m","headers":{"X-Tenant":7}}',
      'headers.X-Tenant'
    );
  });

  it('an unset ${VAR} is a boot error naming the variable and the field', () => {
    withEnv({ EMBED_MISSING_VAR: undefined }, () => {
      expectInvalid(
        '{"providerId":"openai","modelId":"m","apiKey":"${EMBED_MISSING_VAR}"}',
        '"EMBED_MISSING_VAR"',
        'apiKey'
      );
      expectInvalid(
        '{"providerId":"openai","modelId":"m","url":"https://h/${EMBED_MISSING_VAR}/v1"}',
        'in url'
      );
      expectInvalid(
        '{"providerId":"openai","modelId":"m","headers":{"Authorization":"Bearer ${EMBED_MISSING_VAR}"}}',
        'headers.Authorization'
      );
    });
  });

  it('exposes the expected shape used by the message family', () => {
    expect(EMBEDDING_CONFIG_EXPECTED_SHAPE).toContain('"providerId"');
    expect(EMBEDDING_CONFIG_EXPECTED_SHAPE).toContain('"dimension":1536');
  });
});

describe('parseEmbeddingConfig — valid fixtures', () => {
  it('curated shape: id only', () => {
    expect(parseEmbeddingConfig('{"id":"openai/text-embedding-3-small"}')).toEqual({
      id: 'openai/text-embedding-3-small',
    });
  });

  it('third-party shape: providerId + modelId + dimension + url + apiKey + headers', () => {
    const parsed = parseEmbeddingConfig(
      JSON.stringify({
        providerId: 'openai',
        modelId: 'my-embed-v1',
        dimension: 1024,
        url: 'https://gateway.internal/v1',
        apiKey: 'sk-inline',
        headers: { 'X-Tenant': 'acme' },
      })
    );

    expect(parsed).toEqual({
      providerId: 'openai',
      modelId: 'my-embed-v1',
      dimension: 1024,
      url: 'https://gateway.internal/v1',
      apiKey: 'sk-inline',
      headers: { 'X-Tenant': 'acme' },
    });
  });

  it('interpolates ${VAR} in apiKey, url and every header value', () => {
    withEnv({ EMBED_TEST_KEY: 'sk-from-env' }, () => {
      const parsed = parseEmbeddingConfig(
        JSON.stringify({
          providerId: 'openai',
          modelId: 'm',
          url: 'https://${EMBED_TEST_KEY}.gateway/v1',
          apiKey: '${EMBED_TEST_KEY}',
          headers: { Authorization: 'Bearer ${EMBED_TEST_KEY}' },
        })
      );

      expect(parsed?.apiKey).toBe('sk-from-env');
      expect(parsed?.url).toBe('https://sk-from-env.gateway/v1');
      expect(parsed?.headers).toEqual({ Authorization: 'Bearer sk-from-env' });
    });
  });

  it('reports the env var name it reads', () => {
    expect(EMBEDDING_CONFIG_ENV).toBe('EMBEDDING_CONFIG');
  });
});
