import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/*
 * The benchmark page is built only when it is asked for, and into its own
 * directory.
 *
 * It is a measuring instrument rather than part of the product: shipping it
 * would put a page in the image that nobody navigates to, and the startup it
 * measures is the startup of the real `index.html` beside it, so it has to be
 * built together with the workbench rather than against it.
 */
const benchmark = process.env.BENCHMARK_OUTPUT_DIR;

export default defineConfig({
  plugins: [react()],
  build: {
    ...(benchmark ? { outDir: benchmark, emptyOutDir: true } : {}),
    rollupOptions: {
      input: {
        workbench: 'index.html',
        emulator: 'emulator.html',
        ...(benchmark ? { benchmark: 'benchmark.html' } : {}),
      },
      output: {
        manualChunks(id) {
          if (id.endsWith('/src/language/instructionReference6502.ts')) return 'instruction-reference-6502';
          if (id.endsWith('/src/language/acornLanguageReference.ts')) return 'acorn-language-reference';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    testTimeout: 10_000,
    /* Several suites mount the whole workbench or decode a megabyte of pixels.
     * The default five-second hook and teardown bounds are tight enough that a
     * loaded machine fails them for reasons that have nothing to do with the
     * code under test. */
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      /* What the product does, not what surrounds it. A component that only
       * arranges other components inflates a coverage figure without telling
       * anyone whether the rules are right, and the generated documents are
       * data rather than behaviour. */
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/test/**',
        'src/main.tsx',
        'src/samples/**',
        'src/data/compatibilityMatrix.ts',
        'src/data/versioningPolicy.ts',
        'src/data/accessibilityConformance.ts',
      ],
    },
  },
});
