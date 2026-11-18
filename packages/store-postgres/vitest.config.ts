import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The conformance suite runs against a real database (CHATCOPS_TEST_POSTGRES_URL).
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
