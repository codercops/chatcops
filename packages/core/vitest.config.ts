import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Type-level tests (`*.test-d.ts`) run through tsc. They pin the public
    // types that stores, custom providers and the widget rely on.
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.test.json',
    },
  },
});
