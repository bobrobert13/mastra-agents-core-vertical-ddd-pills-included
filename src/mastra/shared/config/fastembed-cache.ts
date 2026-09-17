import { existsSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * On-disk geometry + health of the `@mastra/fastembed` model cache (the
 * zero-key default embedder). Spec 03 §3.3 / ADR-006, gotcha #13.
 *
 * Why this module exists (real incident, 2026-09-17): `@mastra/fastembed`
 * initializes the ONNX model LAZILY on the first `doEmbed`, and its
 * `retrieveModel()` short-circuits with `if (fs.existsSync(modelDir)) return
 * modelDir` — so a directory left behind by an interrupted download/extraction
 * (present dir, absent `model.onnx`) is NEVER repaired and every `doEmbed`
 * throws. That state is decidable from disk, so it is decided here once and
 * consumed by two callers:
 *   - `config/vectors.ts` `buildVectors()` — latches recall OFF at boot so the
 *     banner cannot promise recall the process cannot deliver.
 *   - `scripts/warm-embeddings.ts` — verifies, and repairs a poisoned cache.
 *
 * NO LOCAL IMPORTS on purpose: `scripts/*.ts` run under
 * `node --experimental-strip-types`, which requires full specifiers, so this
 * file must stay importable through an explicit `.../fastembed-cache.ts` path.
 */

/**
 * Model id exactly as the package names it — this is a cache DIRECTORY name,
 * not the banner name: spec 03 §3.9 fixes the display string as
 * `fastembed/multilingual-e5-large · 1024d` (model.ts) and the two must not be
 * conflated.
 */
export const FASTEMBED_MODEL_ID = 'fast-multilingual-e5-large';

/** Cache root — mirrors the package's `getModelCachePath()`. */
export const FASTEMBED_CACHE_DIR = path.join(os.homedir(), '.cache', 'mastra', 'fastembed-models');

/** Per-model directory: its mere existence stops the package from retrying. */
export const FASTEMBED_MODEL_DIR = path.join(FASTEMBED_CACHE_DIR, FASTEMBED_MODEL_ID);

/** The ONNX graph `FlagEmbedding.init()` requires for this model. */
export const FASTEMBED_MODEL_FILE = path.join(FASTEMBED_MODEL_DIR, 'model.onnx');

/** External ONNX weights — must be complete or the session cannot be created. */
export const FASTEMBED_WEIGHTS_FILE = path.join(FASTEMBED_MODEL_DIR, 'model.onnx_data');

/**
 * Download target. The package deletes it ONLY after a full extraction, so a
 * leftover archive means the extraction never finished (truncated download).
 */
export const FASTEMBED_ARCHIVE_FILE = path.join(FASTEMBED_CACHE_DIR, `${FASTEMBED_MODEL_ID}.tar.gz`);

/**
 * true = both artifacts of the model are on disk. Still not proof that the
 * ONNX session builds (only a real `doEmbed` is), but it rules out the
 * poisoned-cache state that fails 100% of the time.
 */
export function fastembedCacheReady(): boolean {
  return existsSync(FASTEMBED_MODEL_FILE) && existsSync(FASTEMBED_WEIGHTS_FILE);
}

/**
 * Deletes the poison: the partial model directory and/or the leftover archive.
 * Scope is ONE model — the shared cache of every other model is untouched.
 * Returns the removed paths so callers can report them.
 */
export function removeFastembedCacheArtifacts(): string[] {
  const removed: string[] = [];
  for (const target of [FASTEMBED_MODEL_DIR, FASTEMBED_ARCHIVE_FILE]) {
    if (!existsSync(target)) continue;
    rmSync(target, { recursive: true, force: true });
    removed.push(target);
  }
  return removed;
}

/** Size in bytes of a cache artifact, or undefined when absent (for reporting). */
export function fastembedArtifactSize(file: string): number | undefined {
  return existsSync(file) ? statSync(file).size : undefined;
}
