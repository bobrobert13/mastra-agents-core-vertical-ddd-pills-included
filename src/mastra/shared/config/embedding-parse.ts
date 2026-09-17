import { z } from 'zod';

/**
 * Pure env parser for the single-var embedder declaration (spec 03 amendment).
 *
 * RUNTIME-DEPENDENCY-FREE BY CONTRACT: this module must never import any
 * `@mastra/*` package or `logger` — the unit tier tests it offline without
 * ever loading the model router or fastembed (shared/AGENTS.md "one reason to
 * change" split). `embedder.ts` (the builder) is the only module allowed to
 * pair it with the SDK.
 */

export const EMBEDDING_CONFIG_ENV = 'EMBEDDING_CONFIG';

/** One validated `EMBEDDING_CONFIG` object (exactly one of `id` or `providerId`+`modelId`). */
export interface EmbeddingConfigEntry {
  id?: string;
  providerId?: string;
  modelId?: string;
  dimension?: number;
  url?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

const ERROR_SUFFIX =
  'Unset the variable to use EMBEDDING_MODEL or the local fastembed default; see .env.example.';

export const EMBEDDING_CONFIG_EXPECTED_SHAPE =
  'Expected a JSON object with EITHER {"id":"provider/model"} OR ' +
  '{"providerId":"provider","modelId":"model"}, ' +
  'e.g. {"providerId":"openai","modelId":"text-embedding-3-small","dimension":1536}';

/** Shared with `.env.example` docs — one message family, `[MCP] Invalid MCP_SERVERS:` style. */
const invalid = (problem: string): string =>
  `[Embeddings] Invalid EMBEDDING_CONFIG: ${problem}. ${EMBEDDING_CONFIG_EXPECTED_SHAPE}. ${ERROR_SUFFIX}`;

/** `${VAR}` references are interpolated from process.env at build time;
 *  an unset VAR is a boot error in the same message family. */
const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function interpolateString(value: string, field: string): string {
  return value.replace(VAR_RE, (match, varName: string) => {
    const resolved = process.env[varName];
    if (resolved === undefined) {
      throw new Error(
        invalid(`environment variable "${varName}" referenced as ${match} in ${field} is not set`)
      );
    }
    return resolved;
  });
}

const configSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[A-Za-z0-9._-]+\/\S+$/,
        'must be "provider/model" (e.g. openai/text-embedding-3-small)'
      )
      .optional(),
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    dimension: z.number().int('must be a positive integer').positive('must be a positive integer').optional(),
    // Protocol is checked AFTER `${VAR}` interpolation: an un-interpolated url
    // is literally "https://x/${PATH}", which `new URL` rejects.
    url: z.string().optional(),
    apiKey: z.string().optional(),
    headers: z.record(z.string()).optional(),
  })
  .strict();

function checkEntry(entry: EmbeddingConfigEntry): void {
  const hasId = entry.id !== undefined;
  const hasProvider = entry.providerId !== undefined;
  const hasModel = entry.modelId !== undefined;

  if (hasId && (hasProvider || hasModel)) {
    throw new Error(invalid('provide EITHER "id" OR "providerId"+"modelId", not both'));
  }
  if (!hasId) {
    if (hasProvider !== hasModel) {
      throw new Error(invalid('"providerId" and "modelId" must be provided together'));
    }
    if (!hasProvider) {
      throw new Error(invalid('exactly one of "id" or "providerId"+"modelId" is required'));
    }
  }

  if (entry.url !== undefined) {
    let protocol: string;
    try {
      protocol = new URL(entry.url).protocol;
    } catch {
      throw new Error(invalid(`invalid "url": not an absolute URL (${entry.url})`));
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(
        invalid(`invalid "url": unsupported protocol "${protocol}" (absolute http/https required)`)
      );
    }
  }
}

function interpolateEntry(entry: EmbeddingConfigEntry): EmbeddingConfigEntry {
  if (entry.apiKey !== undefined) entry.apiKey = interpolateString(entry.apiKey, 'apiKey');
  if (entry.url !== undefined) entry.url = interpolateString(entry.url, 'url');
  if (entry.headers) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry.headers)) {
      headers[key] = interpolateString(value, `headers.${key}`);
    }
    entry.headers = headers;
  }
  return entry;
}

const jsonKind = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value;

/**
 * Parse + validate `EMBEDDING_CONFIG` (spec 03 amendment).
 * - `undefined`, empty/whitespace string ⇒ `undefined` (unset is always legal, never errors).
 * - Set-but-invalid ⇒ throws with the exact `[Embeddings] Invalid EMBEDDING_CONFIG …` family.
 */
export function parseEmbeddingConfig(raw: string | undefined): EmbeddingConfigEntry | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      invalid(`JSON parse failed ("${error instanceof Error ? error.message : String(error)}")`),
      { cause: error }
    );
  }

  if (parsedJson === null || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    throw new Error(invalid(`expected a JSON object, got ${jsonKind(parsedJson)}`));
  }

  const result = configSchema.safeParse(parsedJson);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'config';
    throw new Error(invalid(`${where}: ${issue.message}`));
  }

  const entry = interpolateEntry(result.data as EmbeddingConfigEntry);
  checkEntry(entry);
  return entry;
}
