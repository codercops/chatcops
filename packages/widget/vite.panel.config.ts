import { defineConfig } from 'vite';
import { resolve } from 'path';

// The chat panel as an ES module (chatcops.panel.js), loaded by the loader,
// plus the chunks it loads itself (the pre-chat form) in dist/chunks/.
// Built as an app entry rather than a library so it's fully minified.
export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: 'terser',
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/panel.ts'),
      preserveEntrySignatures: 'strict',
      output: {
        format: 'es',
        entryFileNames: 'chatcops.panel.js',
        // Hashed, so a new release never reuses a cached chunk. The panel's own
        // URL carries ?v=, and chunks are imported relative to it.
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
