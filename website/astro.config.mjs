import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  output: 'static',
  site: 'https://chatcops.codercops.com',
  integrations: [
    starlight({
      title: 'ChatCops',
      description: 'Universal embeddable AI chatbot widget documentation',
      logo: {
        src: './src/assets/chatcops-logo.svg',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/codercops/chatcops' },
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
