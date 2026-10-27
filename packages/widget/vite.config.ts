import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
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
          regex: /^(?:mounted|fab|panel|bubble|preChatFormEl|namespace|hydrated|isStreaming|destroyed|abortController|retryRequests|eventHandlers|containerEl|autoOpenTimer|unreadReplies|savedOverflow|shadow|unreadLabel|openLabel|closeLabel|badge|el|inline|messagesContainer|isVisible|typingEl|suggestionsEl|area|textarea|sendBtn|onSend|timerId)$/,
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
