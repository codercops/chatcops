import type { D1Database } from './types.js';

export const SCHEMA_VERSION = 2;

export const SCHEMA_STATEMENTS = [
  'CREATE TABLE IF NOT EXISTS chatcops_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS chatcops_conversations (id TEXT PRIMARY KEY, metadata TEXT, version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS chatcops_messages (conversation_id TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT NOT NULL, message TEXT NOT NULL, PRIMARY KEY (conversation_id, seq), UNIQUE (conversation_id, id), FOREIGN KEY (conversation_id) REFERENCES chatcops_conversations(id) ON DELETE CASCADE)',
  'CREATE TABLE IF NOT EXISTS chatcops_counters (key TEXT PRIMARY KEY, value REAL NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS chatcops_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS chatcops_events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, data TEXT, created_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS chatcops_conversations_updated_idx ON chatcops_conversations(updated_at DESC, id)',
  'CREATE INDEX IF NOT EXISTS chatcops_events_created_idx ON chatcops_events(created_at)',
  'CREATE INDEX IF NOT EXISTS chatcops_events_type_created_idx ON chatcops_events(type, created_at)',
  `CREATE TABLE IF NOT EXISTS chatcops_vectors (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL,
    metadata TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS chatcops_vectors_source_idx ON chatcops_vectors(source_id)',
  `CREATE VIRTUAL TABLE IF NOT EXISTS chatcops_vectors_fts USING fts5(
    id UNINDEXED,
    text,
    tokenize = 'unicode61'
  )`,
];

export const SCHEMA_SQL = SCHEMA_STATEMENTS.map((s) => `${s};`).join('\n');

export async function initializeSchema(db: D1Database): Promise<void> {
  await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
  const row = await db
    .prepare('SELECT value FROM chatcops_meta WHERE key = ?')
    .bind('schema_version')
    .first<{ value?: string }>();
  if (!row) {
    await db
      .prepare('INSERT INTO chatcops_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
      .bind('schema_version', String(SCHEMA_VERSION))
      .run();
  } else if (Number(row.value) > SCHEMA_VERSION) {
    throw new Error(`Unsupported ChatCops SQLite schema version ${row.value}`);
  } else if (Number(row.value) < SCHEMA_VERSION) {
    await db.prepare('UPDATE chatcops_meta SET value = ? WHERE key = ?').bind(String(SCHEMA_VERSION), 'schema_version').run();
  }
}

const initializingDatabases = new WeakMap<D1Database, Promise<void>>();

export async function ensureSchema(db: D1Database): Promise<void> {
  let promise = initializingDatabases.get(db);
  if (!promise) {
    promise = initializeSchema(db);
    initializingDatabases.set(db, promise);
  }
  return promise;
}
