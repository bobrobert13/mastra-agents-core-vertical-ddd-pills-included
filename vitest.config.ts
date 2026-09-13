import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'workspace'],
    coverage: {
      provider: 'v8',
      // CALIBRATION FIX (spec 07 §3.5): without `include` the sweep also counts
      // the bundled `.mastra/` build artifacts (~255k statements → "All files
      // 0.36%"). Gate scope is src/ only.
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', 'src/**/index.ts'],
      // json-summary so the gate delta is machine-readable (evals-live.yml)
      reporter: ['text', 'json-summary', 'lcov'],
      // Floors calibrated to MEASURED src/ coverage minus margin — ratchet
      // policy (spec 07 risk 3): raise when measured ≥ floor + 2pp; lower
      // only via an explicit reviewed config change. NEVER merge a gate
      // that is red on its own merge commit. See .artifacts/integration-
      // brief-07.md for the final measured calibration on this tree.
      thresholds: { statements: 74, lines: 74, branches: 70, functions: 55 },
    },
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@domains': path.resolve(__dirname, './src/mastra/domains'),
      '@shared': path.resolve(__dirname, './src/mastra/shared'),
      '@infrastructure': path.resolve(__dirname, './src/mastra/infrastructure'),
    },
  },
});
