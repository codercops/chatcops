# @chatcops/store-cloudflare

Cloudflare storage for [ChatCops](https://chat.codercops.com): conversations, exact atomic counters, turn locks, and analytics events backed by Cloudflare D1, Workers KV, and Durable Objects.

## Features

- **Conversations & Messages:** Durable history in Cloudflare D1 SQLite with concurrency-safe `append` without interactive transactions.
- **Exact Counters:** Globally coordinated rate limits and token budgets through Durable Objects (`ChatCopsCounter`), with automatic fallback to D1 `UPSERT ... RETURNING`.
- **Key-Value Store:** Ephemeral key-value caching using Workers KV or D1 SQLite fallback. Turn locks require the D1 fallback because Workers KV does not support atomic `setIfAbsent`; Workers KV also enforces a 60-second minimum TTL.
- **Analytics Events:** Time-bucketed event queries in D1 for dashboards and reporting.

## Install

```bash
npm install @chatcops/store-cloudflare
```

## Wrangler Configuration

Configure your D1 database, Durable Object class binding, and migration in `wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-chatcops-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "chatcops",
      "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ],
  "durable_objects": {
    "bindings": [
      {
        "name": "COUNTERS",
        "class_name": "ChatCopsCounter"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["ChatCopsCounter"]
    }
  ],
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
  ]
}
```

## Usage

Export `ChatCopsCounter` from your Worker's entrypoint so Cloudflare can route Durable Object requests to it:

```ts
import { cloudflareStorage, ChatCopsCounter } from '@chatcops/store-cloudflare';
import { chatcopsCloudflareHandler } from '@chatcops/server/cloudflare';

// Re-export the Durable Object class for Cloudflare Workers
export { ChatCopsCounter };

interface Env {
  DB: D1Database;
  KV?: KVNamespace;
  COUNTERS?: DurableObjectNamespace<ChatCopsCounter>;
  ANTHROPIC_API_KEY: string;
}

let handler: ReturnType<typeof chatcopsCloudflareHandler> | undefined;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    handler ??= chatcopsCloudflareHandler({
      provider: { type: 'claude', apiKey: env.ANTHROPIC_API_KEY },
      systemPrompt: 'You are a helpful assistant.',
      storage: cloudflareStorage({
        d1: env.DB,
        kv: env.KV,
        counters: env.COUNTERS,
      }),
    });

    return handler(request, env, ctx);
  },
};
```

## Options

| Option | Type | Required | Description |
|---|---|---|---|
| `d1` | `D1Database` | **Yes** | Cloudflare D1 database binding used for conversations, messages, events, turn locks, and fallback storage. |
| `kv` | `KVNamespace` | No | Cloudflare Workers KV namespace for fast key-value storage (minimum TTL: 60 seconds). Turn locks require the D1 fallback because Workers KV does not support atomic `setIfAbsent`. When omitted, D1 is used as fallback. |
| `counters` | `DurableObjectNamespace<ChatCopsCounter>` | No | Durable Objects namespace for exact distributed counter coordination. When omitted, D1 atomic upserts are used. |
| `now` | `() => number` | No | Clock function for testing (defaults to `Date.now`). |

## Concurrency & Durability

Cloudflare D1 does not provide interactive transactions. To ensure data integrity under concurrent traffic:

- `append` executes inside a single `db.batch()` statement list.
- An expected-version check conditional update runs first, bumping the version and setting `updated_at`.
- All subsequent message inserts are conditioned on the conversation having that new version and timestamp.
- If concurrent requests race with the same expected version, only one succeeds and the others throw `ConflictError` without creating partial records.
- When no expected version is passed, `append` automatically retries against the latest version.

## Retention & Cleanup

To prune old conversations and expired metadata on a schedule (e.g., via a Cron Trigger):

```ts
// Delete conversations older than 30 days
const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
const purgedCount = await storage.conversations.purge?.(cutoff);
```
