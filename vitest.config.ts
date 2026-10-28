import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every package with tests, including store packages as they're added.
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      // Source files only, so a README or stylesheet in src isn't parsed as code.
      include: ['packages/*/src/**/*.ts'],
      // Sample apps, and the two-line command entry points (their logic is in cli.ts).
      exclude: ['packages/server/src/examples/**', 'packages/store-*/src/bin.ts'],
      reporter: ['text', 'lcov'],
      // Measured coverage rounded down to the nearest 5 (Oct 2026), so CI fails
      // if coverage drops. Raise these when coverage goes up.
      thresholds: {
        'packages/core/src/**': { lines: 80, branches: 80 },
        'packages/server/src/**': { lines: 90, branches: 85 },
        'packages/widget/src/**': { lines: 90, branches: 80 },
        'packages/ingest/src/**': { lines: 85, branches: 80 },
        // Store packages start strict: the conformance suite covers most paths.
        // It needs the databases CI runs, so locally (where those tests skip
        // without CHATCOPS_TEST_* set) the store floor only applies in CI.
        ...(process.env.CI ? { 'packages/store-*/src/**': { lines: 90, branches: 80 } } : {}),
      },
    },
  },
});
