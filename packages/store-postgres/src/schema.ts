import type { Queryable } from './queryable.js';

export interface TableNames {
  conversations: string;
  messages: string;
  counters: string;
  kv: string;
  events: string;
  migrations: string;
  vectorChunks: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,40}$/;

/** Table names for a prefix. The prefix must be a plain lowercase identifier. */
export function tableNames(prefix = 'chatcops_'): TableNames {
  if (!IDENTIFIER.test(prefix)) {
    throw new Error(`tablePrefix must be lowercase letters, digits and underscores, starting with a letter or underscore. Got "${prefix}".`);
  }
  return {
    conversations: `${prefix}conversations`,
    messages: `${prefix}messages`,
    counters: `${prefix}counters`,
    kv: `${prefix}kv`,
    events: `${prefix}events`,
    migrations: `${prefix}migrations`,
    vectorChunks: `${prefix}vector_chunks`,
  };
}

interface Migration {
  id: number;
  name: string;
  statements(t: TableNames): string[];
}

/**
 * The schema, one migration at a time. Statements are idempotent, so running
 * a migration twice is harmless. Times are `timestamptz`; the store reads and
 * writes them as milliseconds.
 */
export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'create tables',
    statements: (t) => [
      `CREATE TABLE IF NOT EXISTS ${t.conversations} (
        id          text PRIMARY KEY,
        metadata    jsonb,
        version     integer NOT NULL DEFAULT 0,
        -- Sequence numbers handed out to messages so far. Only ever grows, so
        -- concurrent appends never pick the same number.
        next_seq    integer NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL,
        updated_at  timestamptz NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS ${t.conversations}_updated_at ON ${t.conversations} (updated_at DESC, id)`,
      `CREATE TABLE IF NOT EXISTS ${t.messages} (
        conversation_id text NOT NULL REFERENCES ${t.conversations} (id) ON DELETE CASCADE,
        seq             integer NOT NULL,
        id              text NOT NULL,
        role            text NOT NULL,
        content         text NOT NULL,
        parts           jsonb,
        status          text,
        usage           jsonb,
        ai_generated    boolean,
        metadata        jsonb,
        -- Message fields this version of the store doesn't know about.
        extra           jsonb,
        sent_at         timestamptz NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (conversation_id, seq)
      )`,
      `CREATE INDEX IF NOT EXISTS ${t.messages}_message_id ON ${t.messages} (conversation_id, id)`,
      `CREATE TABLE IF NOT EXISTS ${t.counters} (
        key         text PRIMARY KEY,
        value       double precision NOT NULL,
        expires_at  timestamptz NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS ${t.counters}_expires_at ON ${t.counters} (expires_at)`,
      `CREATE TABLE IF NOT EXISTS ${t.kv} (
        key         text PRIMARY KEY,
        value       jsonb NOT NULL,
        expires_at  timestamptz
      )`,
      `CREATE INDEX IF NOT EXISTS ${t.kv}_expires_at ON ${t.kv} (expires_at) WHERE expires_at IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS ${t.events} (
        id               bigserial PRIMARY KEY,
        type             text NOT NULL,
        conversation_id  text,
        data             jsonb,
        created_at       timestamptz NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS ${t.events}_type_time ON ${t.events} (type, created_at)`,
    ],
  },
];

export interface MigrateOptions {
  /** Default `chatcops_`. Use the same prefix as `postgresStorage`. */
  tablePrefix?: string;
}

export interface MigrateVectorsOptions {
  /** Embedding length used for the vector column. */
  dimensions: number;
  /** Default `chatcops_`. Use the same prefix as `postgresStorage`. */
  tablePrefix?: string;
}

/** Installs pgvector and creates the optional vector index, independently of `migrate`. */
export async function migrateVectors(db: Queryable, options: MigrateVectorsOptions): Promise<void> {
  if (!Number.isInteger(options.dimensions) || options.dimensions < 1 || options.dimensions > 16_000) {
    throw new Error(`dimensions must be a whole number from 1 to 16000; got ${options.dimensions}.`);
  }
  const t = tableNames(options.tablePrefix);
  await db.query('CREATE EXTENSION IF NOT EXISTS vector');
  await db.query(`CREATE TABLE IF NOT EXISTS ${t.vectorChunks} (
    id text PRIMARY KEY,
    source_id text NOT NULL,
    source jsonb NOT NULL,
    text text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(${options.dimensions}) NOT NULL,
    keyword_vector tsvector NOT NULL
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS ${t.vectorChunks}_hnsw ON ${t.vectorChunks} USING hnsw (embedding vector_cosine_ops)`);
  await db.query(`CREATE INDEX IF NOT EXISTS ${t.vectorChunks}_src ON ${t.vectorChunks} (source_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS ${t.vectorChunks}_fts ON ${t.vectorChunks} USING gin (keyword_vector)`);
}

/**
 * Creates or updates the tables. Safe to run on every deploy: migrations
 * already applied are skipped. Returns the ids it applied.
 */
export async function migrate(db: Queryable, options: MigrateOptions = {}): Promise<{ applied: number[] }> {
  const t = tableNames(options.tablePrefix);
  await db.query(
    `CREATE TABLE IF NOT EXISTS ${t.migrations} (
      id          integer PRIMARY KEY,
      name        text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`
  );
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM ${t.migrations}`);
  const done = new Set(rows.map((row) => Number(row.id)));

  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    for (const statement of migration.statements(t)) await db.query(statement);
    await db.query(`INSERT INTO ${t.migrations} (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
      migration.id,
      migration.name,
    ]);
    applied.push(migration.id);
  }
  return { applied };
}
