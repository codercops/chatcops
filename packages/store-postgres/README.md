# @chatcops/store-postgres

Postgres storage for [ChatCops](https://chat.codercops.com): conversations, rate limit counters, turn locks and analytics events, so they survive restarts and are shared by every server instance.

It works with any driver. Every write is a single SQL statement, so nothing needs a transaction or a dedicated connection, and serverless drivers such as Neon's work as well as `pg`.

## Install

```bash
npm install @chatcops/store-postgres pg
```

`pg` is only needed for the `migrate` command and if you use it as your driver.

## Create the tables

Once per database, and again after upgrading this package:

```bash
DATABASE_URL=postgres://... npx chatcops-postgres migrate
```

Or from code, for example at startup:

```ts
import { migrate } from '@chatcops/store-postgres';
await migrate(pool);
```

Migrations already applied are skipped, so running it on every deploy is fine.

## Use it

```ts
import pg from 'pg';
import { postgresStorage } from '@chatcops/store-postgres';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const storage = postgresStorage({ db: pool });
```

With Neon on Vercel or Cloudflare:

```ts
import { neon } from '@neondatabase/serverless';
import { fromNeon, postgresStorage } from '@chatcops/store-postgres';

const storage = postgresStorage({ db: fromNeon(neon(process.env.DATABASE_URL!)) });
```

With postgres.js, wrap the client the same way: `fromPostgresJs(postgres(url))`.

Pass the complete storage object to the server:

```ts
chatcopsMiddleware({
  provider: { type: 'claude', apiKey: process.env.ANTHROPIC_API_KEY! },
  systemPrompt: 'You are a helpful assistant.',
  storage,
});
```

## Options

| Option | Default | What it does |
|---|---|---|
| `db` | required | A `pg` `Pool`, or a client wrapped with `fromNeon` or `fromPostgresJs`. Anything with `query(text, params)` that returns `{ rows }` works. |
| `tablePrefix` | `'chatcops_'` | Table name prefix, so several apps can share a database. Use the same one with `migrate`. |

## Your own columns

To stamp your own columns on every new conversation and message row (a tenant id, a site id), add them with your own migration, declare them, and say how to fill them:

```ts
// ALTER TABLE chatcops_conversations ADD COLUMN workspace_id uuid;
// ALTER TABLE chatcops_messages ADD COLUMN workspace_id uuid;
const storage = postgresStorage({
  db: pool,
  extraColumns: { workspace_id: 'uuid' },
  rowHook: ({ table, metadata }) => ({ workspace_id: metadata?.workspaceId }),
});
```

The hook runs when a row is created, never on updates. It gets the table, the conversation id, the metadata passed with the write, and the message for message rows. Returning a key that isn't in `extraColumns` throws, and values are sent as query parameters, never put into the SQL. Reads aren't filtered by these columns; that's up to your own queries or row-level security.

## Tables

| Table | Holds |
|---|---|
| `chatcops_conversations` | One row per conversation: metadata, version, timestamps |
| `chatcops_messages` | One row per message, with parts, status and usage as `jsonb` |
| `chatcops_counters` | Rate limit and budget counters with their expiry |
| `chatcops_kv` | Short-lived keys, such as the lock that keeps two replies to one conversation from overlapping |
| `chatcops_events` | Analytics events |

Writing to a conversation is one `INSERT ... ON CONFLICT` that locks its row, so two server instances answering at once never lose a message, and a stale `expectedVersion` fails with a `ConflictError`.

## Retention

Nothing is deleted on its own. Call `purge(before)` on a schedule to delete conversations last updated before a time, with their messages. It also clears expired counters and keys:

```ts
const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
await storage.conversations.purge?.(thirtyDaysAgo);
```

## Testing

The package runs the shared ChatCops storage conformance suite against a real Postgres when `CHATCOPS_TEST_POSTGRES_URL` is set:

```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17-alpine
CHATCOPS_TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @chatcops/store-postgres test
```
