import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { MANGLED_PROPERTIES } from './mangle';

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  define: { __CHATCOPS_VERSION__: JSON.stringify(version) },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ChatCops',
      formats: ['iife', 'es'],
      // The single-file build (chatcops.full.min.js) for sites that can't load a second file,
      // and the ESM build for bundlers. The script tag build is vite.loader.config.ts.
      fileName: (format) => format === 'iife' ? 'chatcops.full.min.js' : 'chatcops.esm.js',
    },
    cssCodeSplit: false,
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2 },
      mangle: {
        properties: {
          regex: MANGLED_PROPERTIES,
        },
      },
    },
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
