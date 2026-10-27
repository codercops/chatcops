import { existsSync, readdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// One translation per file in src/locales (de.ts, pt.ts, ...), each built to
// dist/locales/<code>.js for the loader to fetch next to the panel.
const localeDir = resolve(__dirname, 'src/locales');
const locales = existsSync(localeDir)
  ? Object.fromEntries(
      readdirSync(localeDir)
        .filter((file) => /^[a-z]{2,3}\.ts$/.test(file))
        .map((file) => [`locales/${file.slice(0, -3)}`, resolve(localeDir, file)])
    )
  : {};

// The chat panel as an ES module (chatcops.panel.js), loaded by the loader,
// plus the chunks it loads itself (the pre-chat form) in dist/chunks/.
// Built as an app entry rather than a library so it's fully minified.
export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2 },
      mangle: {
        properties: {
          regex: /^(?:mounted|fab|panel|bubble|preChatFormEl|namespace|hydrated|isStreaming|destroyed|abortController|retryRequests|eventHandlers|containerEl|autoOpenTimer|unreadReplies|savedOverflow|shadow|unreadLabel|openLabel|closeLabel|badge|el|inline|messagesContainer|isVisible|typingEl|suggestionsEl|area|textarea|sendBtn|onSend|timerId)$/,
        },
      },
    },
    cssCodeSplit: false,
    rollupOptions: {
      input: { panel: resolve(__dirname, 'src/panel.ts'), ...locales },
      preserveEntrySignatures: 'strict',
      output: {
        format: 'es',
        entryFileNames: (chunk) => (chunk.name === 'panel' ? 'chatcops.panel.js' : '[name].js'),
        // Hashed, so a new release never reuses a cached chunk. The panel's own
        // URL carries ?v=, and chunks are imported relative to it.
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
