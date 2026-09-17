/**
 * Pre-warm + VERIFY the local `@mastra/fastembed` cache (the zero-key default
 * embedder of this boilerplate).
 *
 *   npm run warm:embeddings
 *   ⇒ node --env-file-if-exists=.env --experimental-strip-types scripts/warm-embeddings.ts
 *     (`--env-file-if-exists` so the script sees the SAME configuration as the app
 *      while staying zero-config safe when there is no .env at all)
 *
 * Why this script exists — two gaps in the package, both hit in the 2026-09-17
 * incident (root AGENTS.md gotcha #13):
 *   1. `warmup()` from @mastra/fastembed only downloads `fast-bge-small/base`;
 *      NOT the `fast-multilingual-e5-large` this repo resolves by default. The
 *      model is initialized LAZILY on the first `doEmbed`, so the first chat
 *      turn pays a ~1.3 GB download + ~2.2 GB extraction.
 *   2. Its cache is STICKY: `retrieveModel()` returns the model directory
 *      whenever it exists, so an interrupted download/extraction leaves a
 *      poisoned cache (directory present, `model.onnx` absent) that throws on
 *      EVERY embed and is never repaired by the package.
 *
 * What it does: exits early when the local cache is not the active embedder,
 * reports an already-healthy cache, and otherwise REPAIRS the poison (delete the
 * partial directory + leftover archive) and re-downloads — finishing with a REAL
 * embed as proof that the ONNX session builds (a file check alone is not proof).
 *
 * STRIP-TYPES RULE: every local import below carries an explicit `.ts`
 * extension; only package + node builtin imports are extensionless.
 */

import { fastembed } from '@mastra/fastembed';

import {
  FASTEMBED_ARCHIVE_FILE,
  FASTEMBED_MODEL_FILE,
  FASTEMBED_WEIGHTS_FILE,
  fastembedArtifactSize,
  fastembedCacheReady,
  removeFastembedCacheArtifacts,
} from '../src/mastra/shared/config/fastembed-cache.ts';

/** Minimal structural view of the provider model — enough to embed and probe. */
interface EmbeddingProbe {
  doEmbed(args: { values: string[] }): Promise<{ embeddings: number[][] }>;
}

const passage = fastembed.multilingualE5LargePassage as unknown as EmbeddingProbe;

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

function size(file: string): string {
  const bytes = fastembedArtifactSize(file);
  return bytes === undefined ? 'missing' : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Real embed — this is what forces the lazy download and builds the ONNX session. */
async function probe(): Promise<number> {
  const { embeddings } = await passage.doEmbed({ values: ['ping'] });
  const dimension = embeddings[0]?.length ?? 0;
  if (dimension === 0) throw new Error('embedder returned no vector for the probe');
  return dimension;
}

async function main(): Promise<number> {
  const hosted = env('EMBEDDING_MODEL');
  if (hosted !== undefined) {
    console.log(
      `[warm-embeddings] EMBEDDING_MODEL=${hosted} — the local fastembed cache is not in use; nothing to warm.`
    );
    return 0;
  }

  if (env('SEMANTIC_RECALL') === 'off') {
    console.log(
      '[warm-embeddings] note: SEMANTIC_RECALL=off — recall is disabled right now, warming the cache anyway (unset it to actually use the embedder).'
    );
  }

  if (fastembedCacheReady()) {
    console.log(`[warm-embeddings] cache present: model.onnx (${size(FASTEMBED_MODEL_FILE)}), model.onnx_data (${size(FASTEMBED_WEIGHTS_FILE)})`);
  } else {
    const removed = removeFastembedCacheArtifacts();
    if (removed.length > 0) {
      console.log('[warm-embeddings] poisoned cache detected (interrupted download/extraction) — removed:');
      for (const target of removed) console.log(`  - ${target}`);
    } else {
      console.log('[warm-embeddings] cold cache — fetching the model.');
    }
    console.log(
      '[warm-embeddings] downloading fast-multilingual-e5-large (~1.3 GB) and extracting it (~2.2 GB); this can take a while.'
    );
  }

  const dimension = await probe(); // forces the lazy download when the model is cold

  if (!fastembedCacheReady()) {
    console.error(`[warm-embeddings] FAILED: ${FASTEMBED_MODEL_FILE} is still missing after the download.`);
    console.error(
      `[warm-embeddings] Extraction was interrupted again. Re-run this script — it clears the partial cache (and any leftover ${FASTEMBED_ARCHIVE_FILE}) before retrying.`
    );
    return 1;
  }

  console.log(
    `[warm-embeddings] verified: real embed returned ${dimension} dimensions. ` +
      'Semantic recall can be enabled (leave SEMANTIC_RECALL unset).'
  );
  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error('[warm-embeddings] FAILED:', error instanceof Error ? error.message : String(error));
  return 1;
});
