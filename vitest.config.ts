import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/core', 'packages/widget', 'packages/server'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      // Sample apps, not library code.
      exclude: ['packages/server/src/examples/**'],
      reporter: ['text', 'lcov'],
      // Measured coverage rounded down to the nearest 5 (Oct 2026), so CI fails
      // if coverage drops. Raise these when coverage goes up.
      thresholds: {
        'packages/core/src/**': { lines: 80, branches: 80 },
        'packages/server/src/**': { lines: 90, branches: 85 },
        'packages/widget/src/**': { lines: 90, branches: 80 },
      },
    },
  },
});
