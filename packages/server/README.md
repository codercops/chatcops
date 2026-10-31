# @chatcops/server

Server-side handler and platform adapters for ChatCops. It streams replies, checks session tokens and origins, rate limits, sends webhooks and keeps analytics.

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

// app.use, so /chat/session, where the widget gets its session token, reaches it too.
app.use('/chat', chatcopsMiddleware({
  provider: {
    type: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  systemPrompt: 'You are a helpful assistant for our website.',
  allowedOrigins: ['*'],
  sessionSecrets: [process.env.CHATCOPS_SESSION_SECRET!], // openssl rand -base64 32
}));

app.listen(3001);
```

### Vercel Edge

```typescript
import { chatcopsVercelHandler } from '@chatcops/server';

const handler = chatcopsVercelHandler({
  provider: { type: 'openai', apiKey: process.env.OPENAI_API_KEY! },
  systemPrompt: 'You are a helpful assistant.',
  allowedOrigins: ['*'],
  sessionSecrets: [process.env.CHATCOPS_SESSION_SECRET!],
});

export const POST = (req: Request) => handler(req);
export const OPTIONS = (req: Request) => handler(req);
export const config = { runtime: 'edge' };
```

Export the same handler from the `/session` route next to it (`app/api/chat/session/route.ts` for a chat at `/api/chat`), where the widget gets its session token.

### Cloudflare Workers

```typescript
import { chatcopsCloudflareHandler } from '@chatcops/server';

let handler: ReturnType<typeof chatcopsCloudflareHandler> | undefined;
function getHandler(env: Env) {
  handler ??= chatcopsCloudflareHandler({
    provider: { type: 'claude', apiKey: env.ANTHROPIC_API_KEY },
    systemPrompt: 'You are a helpful assistant.',
    allowedOrigins: ['*'],
    sessionSecrets: [env.CHATCOPS_SESSION_SECRET],
  });
  return handler;
}

export default {
  async fetch(request: Request, env: Env) {
    return getHandler(env)(request);
  },
};
```

## Configuration

```typescript
import { createChatHandler } from '@chatcops/server';
import { LeadCaptureTool, FAQKnowledgeSource } from '@chatcops/core';
import { sqliteStorage } from '@chatcops/store-sqlite';

const handler = createChatHandler({
  // AI provider (required)
  provider: {
    type: 'claude',          // 'claude' | 'openai' | 'gemini'
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-haiku-5-5',
  },

  // System prompt (required)
  systemPrompt: 'You are a helpful support assistant.',

  // Session tokens: required unless allowAnonymous: true (openssl rand -base64 32)
  sessionSecrets: [process.env.CHATCOPS_SESSION_SECRET!],

  // The sites whose pages can use the chat (default: any)
  allowedOrigins: ['https://acme.com'],

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

  // Requests per visitor IP (optional, default: 30 per 60 s)
  rateLimit: { maxRequests: 10, windowMs: 60_000 },

  // Webhooks (optional)
  webhooks: [
    { url: 'https://hooks.example.com/leads', events: ['lead:captured'], secret: process.env.WEBHOOK_SECRET },
  ],

  // Analytics (optional)
  analytics: true,

  // Conversations, rate limit counters and analytics (optional, default: in memory, per process)
  storage: sqliteStorage({ path: './chatcops.db' }),
});
```

Every option is in the [server setup docs](https://chat.codercops.com/server/setup/).

## Stream format

A reply streams as Server-Sent Events, one JSON part per event, in protocol v1:

```text
data: {"type":"start","protocol":1,"conversationId":"c-1","messageId":"m-1"}

data: {"type":"text-start","id":"m-1-1"}

data: {"type":"text-delta","id":"m-1-1","delta":"Hello"}

data: {"type":"text-end","id":"m-1-1"}

data: {"type":"finish","reason":"stop"}

data: [DONE]
```

Tool calls, sources and errors are parts too. The [protocol docs](https://chat.codercops.com/server/protocol/) list them all. A client that doesn't send `"protocol": 1`, such as a widget older than 0.6, gets the 0.5 format (`{"content":"..."}` events) until 2.0.

## Rate limiting and budgets

`rateLimit` counts requests per visitor IP, 30 per minute by default. `budgets` caps replies and tokens per conversation, per IP per day and in total per day. Both are counted in `storage`, so with a store package (below) the limits hold across all your server instances, not just within one process. Behind a proxy, set `clientIp` so the server reads the visitor's IP from the right header.

## Webhooks

HMAC-SHA256 signed, with retries (up to 3 attempts). Set them with the `webhooks` option above. Each delivery carries `X-ChatCops-Signature: t=<seconds>,v1=<hmac>`, signed over the raw body. Check it on the receiving side with `verifyWebhook`:

```typescript
import { verifyWebhook } from '@chatcops/server';

export async function POST(request: Request): Promise<Response> {
  // The raw body, before any JSON parsing: the signature is over these exact bytes.
  const body = await request.text();
  const valid = await verifyWebhook({ body, signature: request.headers.get('X-ChatCops-Signature'), secret: process.env.WEBHOOK_SECRET! });
  if (!valid) return new Response('Bad signature', { status: 401 });
  const { type, data } = JSON.parse(body);
  console.log(type, data);
  return new Response(null, { status: 204 });
}
```

The body is `{ id, type, created, data }`; `id` stays the same across retries. 429 and 5xx responses are retried, redirects aren't followed, and URLs must be https on a public host unless the webhook sets `allowPrivateNetwork: true`. See the server setup docs for the full format.

## Storage

By default everything is held in memory, per process. To keep conversations across restarts, or share them and the rate limit counters across instances, pass a store package as `storage`:

| Package | For |
|---|---|
| `@chatcops/store-postgres` | Postgres, including Neon and Supabase |
| `@chatcops/store-redis` | Redis, Valkey and Upstash Redis |
| `@chatcops/store-sqlite` | One Node server with a local file |
| `@chatcops/store-cloudflare` | Cloudflare D1, with Durable Objects for counters |

To write your own, implement `ConversationStore` (and optionally the counter, key-value and event stores) from `@chatcops/core`, and check it with `runStorageConformance` from `@chatcops/core/testing`. The [storage docs](https://chat.codercops.com/server/storage/) have the details.

## Custom integrations

For a runtime with the Fetch API's `Request` and `Response` (Next.js, Hono, Bun, Deno, Workers), pass requests to `chatcopsVercelHandler(config)`: it's a plain `(Request) => Promise<Response>`. For Node's `req` and `res` (`node:http`, Fastify, Koa), turn the request into a `Request` and stream the `Response` back. The docs have the code: [Next.js, Hono, Bun and Deno](https://chat.codercops.com/server/fetch-runtimes/). Route both the chat path and `<chat path>/session` to it, since the widget gets its session token there.

The handler does CORS, `allowedOrigins`, body limits, pings, session tokens and the 0.5 format for old widgets, so bridging to it is better than calling `createChatHandler` and writing the HTTP side yourself.

## License

MIT
