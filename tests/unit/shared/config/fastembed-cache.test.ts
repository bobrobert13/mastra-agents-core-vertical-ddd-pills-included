import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  FASTEMBED_ARCHIVE_FILE,
  FASTEMBED_CACHE_DIR,
  FASTEMBED_MODEL_DIR,
  FASTEMBED_MODEL_FILE,
  FASTEMBED_WEIGHTS_FILE,
  fastembedArtifactSize,
} from '../../../../src/mastra/shared/config/fastembed-cache';

/**
 * Cache geometry of the fastembed mirror (gotcha #13). The paths are DERIVED from
 * os.homedir() at import time, so only the shape is asserted here — the real
 * state of this machine's ~/.cache must never decide a unit case (that is what
 * the `fastembedCacheReady` seam in buildVectors is for).
 *
 * `fastembedCacheReady`/`removeFastembedCacheArtifacts` are deliberately NOT
 * called: they resolve to the operator's real cache, and a unit test must not
 * read or delete it. The repair path is exercised by `npm run warm:embeddings`.
 */
describe('fastembed cache geometry', () => {
  it('mirrors the package layout under ~/.cache/mastra/fastembed-models', () => {
    expect(FASTEMBED_CACHE_DIR).toBe(
      path.join(os.homedir(), '.cache', 'mastra', 'fastembed-models')
    );
    expect(FASTEMBED_MODEL_DIR).toBe(path.join(FASTEMBED_CACHE_DIR, 'fast-multilingual-e5-large'));
    expect(FASTEMBED_MODEL_FILE).toBe(path.join(FASTEMBED_MODEL_DIR, 'model.onnx'));
    expect(FASTEMBED_WEIGHTS_FILE).toBe(path.join(FASTEMBED_MODEL_DIR, 'model.onnx_data'));
    // The archive lives NEXT to the model dir (not inside it) — its leftover is
    // the fingerprint of an extraction that never finished.
    expect(FASTEMBED_ARCHIVE_FILE).toBe(
      path.join(FASTEMBED_CACHE_DIR, 'fast-multilingual-e5-large.tar.gz')
    );
  });
});

describe('fastembedArtifactSize', () => {
  it('reports bytes for an existing file and undefined when it is absent', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fastembed-cache-'));
    try {
      const file = path.join(dir, 'artifact.bin');
      expect(fastembedArtifactSize(file)).toBeUndefined();
      writeFileSync(file, 'abcd');
      expect(fastembedArtifactSize(file)).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
