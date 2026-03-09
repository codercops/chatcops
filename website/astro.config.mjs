import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'static',
  adapter: vercel(),
  site: 'https://chat.codercops.com',
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    react(),
    starlight({
      title: 'ChatCops',
      description: 'Universal embeddable AI chatbot widget documentation',
      logo: {
        src: './src/assets/chatcops-logo.svg',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/codercops/chatcops' },
      ],
      head: [
        {
          tag: 'script',
          attrs: {
            src: 'https://www.googletagmanager.com/gtag/js?id=G-GLYL9J6QYX',
            async: true,
          },
        },
        {
          tag: 'script',
          content: `window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-GLYL9J6QYX');`,
        },
        {
          tag: 'script',
          attrs: {
            src: 'https://cdn.jsdelivr.net/npm/@chatcops/widget@0.2.0/dist/chatcops.min.js',
            'data-api-url': '/api/chat',
            'data-accent': '#6366f1',
            'data-brand-name': 'ChatCops AI',
            'data-welcome-message': "Hi! I'm the ChatCops assistant. Ask me anything about setting up ChatCops on your website.",
            'data-position': 'bottom-right',
            defer: true,
          },
        },
      ],
      customCss: [
        '@fontsource/inter/400.css',
        '@fontsource/inter/500.css',
        '@fontsource/inter/600.css',
        '@fontsource/jetbrains-mono/400.css',
        '@fontsource/jetbrains-mono/500.css',
        './src/styles/starlight-overrides.css',
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Installation', slug: 'getting-started/installation' },
          ],
        },
        {
          label: 'Widget',
          items: [
            { label: 'Configuration', slug: 'widget/configuration' },
            { label: 'API Reference', slug: 'widget/api' },
            { label: 'Theming', slug: 'widget/theming' },
            { label: 'Events', slug: 'widget/events' },
            { label: 'Internationalization', slug: 'widget/i18n' },
          ],
        },
        {
          label: 'Server',
          items: [
            { label: 'Setup', slug: 'server/setup' },
            { label: 'Express', slug: 'server/express' },
            { label: 'Vercel', slug: 'server/vercel' },
            { label: 'Cloudflare Workers', slug: 'server/cloudflare' },
          ],
        },
        {
          label: 'Core',
          items: [
            { label: 'AI Providers', slug: 'core/providers' },
            { label: 'Tools', slug: 'core/tools' },
            { label: 'Knowledge Base', slug: 'core/knowledge-base' },
            { label: 'Analytics', slug: 'core/analytics' },
          ],
        },
        {
          label: 'Full Examples',
          items: [
            { label: 'Express Server', slug: 'examples/express-full' },
            { label: 'Vercel Edge', slug: 'examples/vercel-full' },
            { label: 'Cloudflare Worker', slug: 'examples/cloudflare-full' },
          ],
        },
      ],
    }),
  ],
});
