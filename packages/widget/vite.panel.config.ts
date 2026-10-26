import { defineConfig } from 'vite';
import { resolve } from 'path';

// The chat panel as one ES module (chatcops.panel.js), loaded by the loader.
// Built as an app entry rather than a library so it's fully minified.
export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: 'terser',
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/panel.ts'),
      preserveEntrySignatures: 'strict',
      output: { format: 'es', entryFileNames: 'chatcops.panel.js', inlineDynamicImports: true },
    },
  },
});
