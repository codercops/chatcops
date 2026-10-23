# @chatcops/store-sqlite

SQLite storage for ChatCops single-server deployments. It uses Node.js 22.13+'s built-in `node:sqlite`, so no native database dependency is required.

Node may print an `ExperimentalWarning` the first time `node:sqlite` loads; this is expected from Node and is not an error.

```bash
pnpm add @chatcops/store-sqlite
```

```ts
import { chatcopsMiddleware } from '@chatcops/server';
import { sqliteStorage } from '@chatcops/store-sqlite';

const storage = sqliteStorage({ path: './chatcops.db' });

app.use('/api/chat', chatcopsMiddleware({
  provider,
  systemPrompt: 'You are a helpful assistant.',
  storage,
}));
```

Use `path: ':memory:'` for tests, or pass an already-open `node:sqlite` `DatabaseSync` (or structurally compatible better-sqlite3 database) with `database`.

SQLite is intended here for one server process and a local file. Back up the database file using your normal deployment process. Call `await storage.close?.()` during graceful shutdown.

## Extra columns

To stamp columns of your own (a tenant or site id) on every new row, add them with your own `ALTER TABLE` and pass `extraColumns` with a `rowHook`:

```ts
database.exec('ALTER TABLE chatcops_conversations ADD COLUMN workspace_id TEXT');
database.exec('ALTER TABLE chatcops_messages ADD COLUMN workspace_id TEXT');

const storage = sqliteStorage({
  database,
  extraColumns: ['workspace_id'],
  rowHook: ({ metadata }) => ({ workspace_id: metadata?.workspaceId }),
});
```

The hook runs when a row is created, never on updates. It gets the table, the conversation id, the metadata passed with the write, and the message for message rows. Returning a key that isn't in `extraColumns` throws and nothing from that write is stored. Values are bound as parameters, never put into the SQL, and must be strings, numbers, booleans (stored as 1 or 0) or null.

The `{ workspace_id: 'uuid' }` form from `@chatcops/store-postgres` works too, so one config fits both stores. SQLite ignores the type.
