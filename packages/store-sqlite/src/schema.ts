import type { SqliteDatabase } from './database.js';

export const SCHEMA_VERSION = 1;

export function initializeSchema(db: SqliteDatabase): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chatcops_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chatcops_conversations (
      id TEXT PRIMARY KEY, metadata TEXT, version INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chatcops_messages (
      conversation_id TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT NOT NULL,
      message TEXT NOT NULL, PRIMARY KEY (conversation_id, seq),
      UNIQUE (conversation_id, id),
      FOREIGN KEY (conversation_id) REFERENCES chatcops_conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS chatcops_counters (
      key TEXT PRIMARY KEY, value REAL NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chatcops_kv (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS chatcops_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, data TEXT, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chatcops_conversations_updated_idx ON chatcops_conversations(updated_at DESC, id);
    CREATE INDEX IF NOT EXISTS chatcops_events_created_idx ON chatcops_events(created_at);
    CREATE INDEX IF NOT EXISTS chatcops_events_type_created_idx ON chatcops_events(type, created_at);
  `);
  const row = db.prepare('SELECT value FROM chatcops_meta WHERE key = ?').get('schema_version') as { value?: string } | undefined;
  if (!row) db.prepare('INSERT INTO chatcops_meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  else if (Number(row.value) > SCHEMA_VERSION) throw new Error(`Unsupported ChatCops SQLite schema version ${row.value}`);
}
