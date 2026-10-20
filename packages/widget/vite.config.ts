import { defineConfig } from 'vite';
import { resolve } from 'path';

// Node 25 turned on its own localStorage, which hides happy-dom's in the tests
// ("localStorage.clear is not a function"). Older versions don't have it on.
const nodeMajor = Number(process.versions.node.split('.')[0]);

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
    execArgv: nodeMajor >= 25 ? ['--no-experimental-webstorage'] : [],
  },
});
