import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ChatCops',
      formats: ['iife', 'es'],
      fileName: (format) => format === 'iife' ? 'chatcops.min.js' : 'chatcops.esm.js',
    },
    cssCodeSplit: false,
    minify: 'terser',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        exports: 'named',
        footer:
          'if (typeof window !== "undefined" && window.ChatCops && window.ChatCops.default) { Object.assign(window.ChatCops, window.ChatCops.default); }',
      },
    },
  },
  test: {
    environment: 'happy-dom',
    // Type-level tests: the protocol types the widget copies from core.
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.test.json',
    },
  },
});
