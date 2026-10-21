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
