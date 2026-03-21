# @chatcops/server

Server-side handler and platform adapters for ChatCops. Handles streaming responses, rate limiting, webhooks, and analytics.

## Install

```bash
npm install @chatcops/server @chatcops/core
```

## Quick Start

### Express

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
  cors: '*',
}));

app.listen(3001);
```

### Vercel Edge

```typescript
import { chatcopsVercelHandler } from '@chatcops/server';

const handler = chatcopsVercelHandler({
  provider: { type: 'openai', apiKey: process.env.OPENAI_API_KEY },
  systemPrompt: 'You are a helpful assistant.',
  cors: '*',
});

export const POST = (req: Request) => handler(req);
export const OPTIONS = (req: Request) => handler(req);
export const config = { runtime: 'edge' };
```

### Cloudflare Workers

```typescript
import { chatcopsCloudflareHandler } from '@chatcops/server';

export default {
  async fetch(request: Request, env: Env) {
    const handler = chatcopsCloudflareHandler({
      provider: { type: 'claude', apiKey: env.ANTHROPIC_API_KEY },
      systemPrompt: 'You are a helpful assistant.',
      cors: '*',
    });
    return handler(request);
  },
};
```

## Configuration

```typescript
import { createChatHandler } from '@chatcops/server';
import { LeadCaptureTool, FAQKnowledgeSource } from '@chatcops/core';

const handler = createChatHandler({
  // AI provider (required)
  provider: {
    type: 'claude',          // 'claude' | 'openai' | 'gemini'
    apiKey: 'sk-...',
    model: 'claude-haiku-4-5-20251001',
  },

  // System prompt (required)
  systemPrompt: 'You are a helpful support assistant.',

  // Tools (optional)
  tools: [
    new LeadCaptureTool((lead) => {
      console.log('New lead:', lead.email);
    }),
  ],

  // Knowledge base (optional)
  knowledge: [
    new FAQKnowledgeSource([
      { question: 'What do you do?', answer: 'We build software.' },
    ]),
  ],

  // Rate limiting (optional, default: 30 req/60s)
  rateLimit: { maxRequests: 10, windowMs: 60_000 },

  // Webhooks (optional)
  webhooks: [
    { url: 'https://hooks.example.com/leads', events: ['lead:captured'] },
  ],

  // Analytics (optional)
  analytics: true,

  // CORS origin (required)
  cors: '*',
});
```

## SSE Stream Format

All adapters produce identical Server-Sent Events:

```
data: {"content":"Hello"}
data: {"content":" there!"}
data: {"done":true}
data: [DONE]
```

On error:

```
data: {"error":"rate_limit","retryAfter":42}
data: [DONE]
```

Error codes: `invalid_request`, `rate_limit`, `provider_error`, `internal_error`.

## Rate Limiting

In-memory, per-IP. Suitable for single-instance deployments.

```typescript
import { RateLimiter } from '@chatcops/server';

const limiter = new RateLimiter({ maxRequests: 30, windowMs: 60_000 });
const result = limiter.check('127.0.0.1');
// { allowed: true } or { allowed: false, retryAfter: 42 }
```

## Webhooks

HMAC-SHA256 signed, with exponential backoff retries (up to 3 attempts).

```typescript
import { WebhookDispatcher } from '@chatcops/server';

const dispatcher = new WebhookDispatcher([
  { url: 'https://hooks.example.com/chat', events: ['*'], secret: 'my-secret' },
]);

await dispatcher.dispatch('lead:captured', { email: 'user@example.com' });
```

Signature sent via `X-ChatCops-Signature` header.

## License

MIT
