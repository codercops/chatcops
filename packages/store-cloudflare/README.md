# @chatcops/store-cloudflare

Cloudflare storage for [ChatCops](https://chat.codercops.com): conversations, exact atomic counters, turn locks, and analytics events backed by Cloudflare D1 and Durable Objects.

## Features

- **Conversations & Messages:** Durable history in Cloudflare D1 SQLite with concurrency-safe `append` without interactive transactions.
- **Exact Counters:** Globally coordinated rate limits and token budgets through Durable Objects (`ChatCopsCounter`), with automatic fallback to D1 `UPSERT ... RETURNING`.
- **Turn locks:** In D1, with an atomic `setIfAbsent`, so one reply per conversation holds across every isolate. Workers KV isn't used: it has no atomic `setIfAbsent`, and its TTLs start at 60 seconds.
- **Analytics Events:** Time-bucketed event queries in D1 for dashboards and reporting.
- **Vector search:** Optional Cloudflare Vectorize embeddings with D1-backed text, source data, filters, and FTS5 keyword search.

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
| `counters` | `DurableObjectNamespace<ChatCopsCounter>` | No | Durable Objects namespace for exact distributed counter coordination. When omitted, D1 atomic upserts are used. |
| `extraColumns` | `string[]` or `Record<string, string>` | No | Columns you've added yourself, filled in by `rowHook`. See below. |
| `rowHook` | `(context) => Record<string, unknown>` | No | Values for `extraColumns` on each new row. |
| `now` | `() => number` | No | Clock function for testing (defaults to `Date.now`). |

## Vectorize

Pass a Vectorize index and its configured dimensions to expose `storage.vectors`:

```ts
const storage = cloudflareStorage({
  d1: env.DB,
  vectorize: env.VECTORIZE,
  vectorDimensions: 1536,
});
```

Create the index with `cosine` distance and create a Vectorize metadata index for every metadata key used in vector filters. The store keeps vectors and filterable metadata in Vectorize, while D1 stores the complete text and source details and powers `keywordQuery` with FTS5. Miniflare cannot run Vectorize; the package tests use an in-memory binding double.

## Extra columns

To stamp columns of your own (a tenant or site id) on every new row, add them with your own `ALTER TABLE` and pass `extraColumns` with a `rowHook`:

```sql
ALTER TABLE chatcops_conversations ADD COLUMN workspace_id TEXT;
ALTER TABLE chatcops_messages ADD COLUMN workspace_id TEXT;
```

```ts
cloudflareStorage({
  d1: env.DB,
  extraColumns: ['workspace_id'],
  rowHook: ({ metadata }) => ({ workspace_id: metadata?.workspaceId }),
});
```

The hook runs when a row is created, never on updates. It gets the table, the conversation id, the metadata passed with the write, and the message for message rows. Returning a key that isn't in `extraColumns` throws, and nothing from that write is stored. Values are bound as parameters, never put into the SQL, and must be strings, numbers, booleans (stored as 1 or 0, so use an `INTEGER` column) or null. The `{ workspace_id: 'uuid' }` form from `@chatcops/store-postgres` works too; D1 ignores the type.

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
