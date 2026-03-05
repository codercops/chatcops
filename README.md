# ChatCops

Universal, embeddable AI chatbot widget. Add an AI assistant to any website with a single `<script>` tag.

Multi-provider (Claude, OpenAI, Gemini), lead capture, knowledge base, conversation persistence, analytics, and i18n.

## Quick Start

### 1. Add the widget to your site

```html
<script
  src="https://cdn.jsdelivr.net/npm/@chatcops/widget/dist/chatcops.min.js"
  data-api-url="https://your-api.com/chat"
  data-accent="#6366f1">
</script>
```

### 2. Set up the server

```bash
npm install @chatcops/server express
```

```typescript
import express from 'express';
import { chatcopsMiddleware } from '@chatcops/server';

const app = express();
app.use(express.json());

app.post('/chat', chatcopsMiddleware({
  provider: {
    type: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  systemPrompt: 'You are a helpful assistant for our website.',
}));

app.listen(3001);
```

That's it. Your site now has an AI chat widget.

## Features

- **Multi-provider** - Claude, OpenAI, Gemini. Switch with one config change.
- **Zero-dependency widget** - Shadow DOM isolated, ~50KB gzipped.
- **Streaming responses** - Real-time SSE streaming from all providers.
- **Lead capture** - Built-in tool for capturing contact info, with webhook support.
- **Knowledge base** - Feed text chunks or FAQ pairs for context-aware responses.
- **Conversation persistence** - localStorage on client, pluggable stores on server.
- **Analytics** - Track conversations, messages, and lead captures.
- **i18n** - 8 built-in locales, fully customizable strings.
- **Deployable anywhere** - Express, Vercel, Cloudflare Workers adapters included.
- **Customizable** - Theme, branding, position, welcome messages, callbacks.

## Packages

| Package | Description |
|---------|-------------|
| [`@chatcops/core`](./packages/core) | AI provider abstraction, tools, knowledge base, i18n |
| [`@chatcops/widget`](./packages/widget) | Embeddable chat widget (IIFE + ESM) |
| [`@chatcops/server`](./packages/server) | Server handler + Express/Vercel/Cloudflare adapters |

## Architecture

```
Host Website                    Server
┌──────────────┐     SSE      ┌──────────────┐
│ <script>     │ ──────────>  │ Handler      │
│ Shadow DOM   │ <──────────  │ ├─ Provider   │
│ Chat Widget  │   streaming  │ ├─ Knowledge  │
└──────────────┘              │ ├─ Tools      │
                              │ └─ Analytics  │
                              └──────────────┘
```

## Widget Configuration

```typescript
import ChatCops from '@chatcops/widget';

ChatCops.init({
  apiUrl: 'https://your-api.com/chat',
  theme: {
    accent: '#E07A5F',
    position: 'bottom-right',
  },
  branding: {
    name: 'Support Bot',
    subtitle: 'Online',
  },
  welcomeMessage: 'Hi! How can I help you today?',
  welcomeBubble: {
    text: 'Need help? Chat with us!',
    delay: 3000,
  },
  locale: 'en',
  persistHistory: true,
  onMessage: (msg) => console.log('New message:', msg),
});
```

## Server Adapters

### Vercel

```typescript
import { chatcopsVercelHandler } from '@chatcops/server/vercel';

export default chatcopsVercelHandler({
  provider: { type: 'claude', apiKey: process.env.ANTHROPIC_API_KEY },
  systemPrompt: 'You are a helpful assistant.',
});
```

### Cloudflare Workers

```typescript
import { chatcopsCloudflareHandler } from '@chatcops/server/cloudflare';

export default {
  fetch: chatcopsCloudflareHandler({
    provider: { type: 'openai', apiKey: env.OPENAI_API_KEY },
    systemPrompt: 'You are a helpful assistant.',
  }),
};
```

## Development

```bash
pnpm install
pnpm -r build
pnpm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## License

MIT
