import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { resolve } from 'path';

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

// The script tag build (chatcops.min.js): the launcher and the panel loader.
export default defineConfig({
  define: { __CHATCOPS_VERSION__: JSON.stringify(version) },
  build: {
    emptyOutDir: false,
    minify: 'terser',
    lib: {
      entry: resolve(__dirname, 'src/loader/index.ts'),
      name: 'ChatCopsLoader',
      formats: ['iife'],
      fileName: () => 'chatcops.min.js',
    },
  },
});
