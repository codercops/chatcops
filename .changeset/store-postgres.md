---
"@chatcops/store-postgres": minor
---

New package: Postgres storage for conversations, counters, keys and analytics events. Works with `pg`, Neon (`fromNeon`) and postgres.js (`fromPostgresJs`), since every write is a single statement. Create the tables with `npx chatcops-postgres migrate` or `migrate(db)`.
