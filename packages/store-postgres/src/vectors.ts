import type {
  KeywordQuery,
  MetadataFilter,
  ScoredRecord,
  VectorQuery,
  VectorRecord,
  VectorStore,
} from '@chatcops/core';
import { segmentWords } from '@chatcops/core';
import type { Queryable } from './queryable.js';

interface PgConnection extends Queryable {
  release?(): void;
  connection?: unknown;
}

interface PgPool extends Queryable {
  connect(): Promise<PgConnection>;
}

interface Row {
  id: string;
  text: string;
  source: VectorRecord['source'];
  metadata: VectorRecord['metadata'];
  score: number;
}

/** Postgres pgvector-backed storage for embedded page chunks. */
export class PostgresVectorStore implements VectorStore {
  constructor(
    readonly dimensions: number,
    private readonly db: Queryable,
    private readonly table: string
  ) {
    if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 16_000) {
      throw new Error(`dimensions must be a whole number from 1 to 16000; got ${dimensions}.`);
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) this.checkVector(record.vector, `record ${record.id}`);
    for (const record of records) {
      const words = segmentWords(record.text).join(' ');
      await this.db.query(
        `INSERT INTO ${this.table} (id, source_id, source, text, metadata, embedding, keyword_vector)
         VALUES ($1, $2, $3::text::jsonb, $4, $5::text::jsonb, $6::text::vector, to_tsvector('simple', $7))
         ON CONFLICT (id) DO UPDATE SET source_id = EXCLUDED.source_id, source = EXCLUDED.source,
           text = EXCLUDED.text, metadata = EXCLUDED.metadata, embedding = EXCLUDED.embedding,
           keyword_vector = EXCLUDED.keyword_vector`,
        [record.id, record.source.id, JSON.stringify(record.source), record.text, JSON.stringify(record.metadata ?? {}), toVector(record.vector), words]
      );
    }
  }

  async query({ vector, topK, filter }: VectorQuery): Promise<ScoredRecord[]> {
    this.checkVector(vector, 'the query');
    const limit = limitFor(topK);
    if (!limit) return [];
    const params: unknown[] = [toVector(vector)];
    const where = metadataWhere(filter, params);
    params.push(limit);
    const sql = `WITH nearest AS MATERIALIZED (
      SELECT id, text, source, metadata, embedding <=> $1::text::vector AS distance
      FROM ${this.table} ${where}
      ORDER BY embedding <=> $1::text::vector
      LIMIT $${params.length}
    )
    SELECT id, text, source, metadata, coalesce(1 - distance, 0)::float8 AS score
    FROM nearest ORDER BY distance + 0, id`;
    const hasFilter = Object.keys(filter ?? {}).length > 0;
    const result = hasFilter
      ? await inTransaction(this.db, async (tx) => {
          await tx.query("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
          return tx.query<Row>(sql, params);
        })
      : await this.db.query<Row>(sql, params);
    return result.rows.map(asScoredRecord);
  }

  async keywordQuery({ text, topK, filter }: KeywordQuery): Promise<ScoredRecord[]> {
    const limit = limitFor(topK);
    const words = segmentWords(text).join(' ');
    if (!limit || !words) return [];
    const params: unknown[] = [words];
    const where = metadataWhere(filter, params);
    params.push(limit);
    const { rows } = await this.db.query<Row>(
      `WITH search AS (SELECT plainto_tsquery('simple', $1) AS query)
       SELECT id, text, source, metadata, ts_rank(keyword_vector, search.query)::float8 AS score
       FROM ${this.table}, search
       WHERE keyword_vector @@ search.query${where ? ` AND ${where.slice('WHERE '.length)}` : ''}
       ORDER BY score DESC, id LIMIT $${params.length}`,
      params
    );
    return rows.map(asScoredRecord);
  }

  async deleteBySource(sourceId: string): Promise<void> {
    await this.db.query(`DELETE FROM ${this.table} WHERE source_id = $1`, [sourceId]);
  }

  private checkVector(vector: Float32Array, what: string): void {
    if (vector.length !== this.dimensions) {
      throw new Error(`The vector for ${what} has ${vector.length} dimensions, but this store holds ${this.dimensions}.`);
    }
    if (!vector.every(Number.isFinite)) throw new Error(`The vector for ${what} has a value that isn't a finite number.`);
  }
}

function toVector(vector: Float32Array): string {
  return `[${Array.from(vector).join(',')}]`;
}

function limitFor(topK: number): number {
  return Number.isFinite(topK) && topK >= 1 ? Math.floor(topK) : 0;
}

function metadataWhere(filter: MetadataFilter | undefined, params: unknown[]): string {
  if (!filter) return '';
  const clauses: string[] = [];
  for (const [key, value] of Object.entries(filter)) {
    params.push(key);
    const keyParam = `$${params.length}`;
    if (Array.isArray(value)) {
      params.push(JSON.stringify(value));
      clauses.push(`EXISTS (SELECT 1 FROM jsonb_array_elements($${params.length}::text::jsonb) AS wanted(value) WHERE metadata -> ${keyParam}::text = wanted.value)`);
    } else {
      params.push(JSON.stringify(value));
      clauses.push(`metadata -> ${keyParam}::text = $${params.length}::text::jsonb`);
    }
  }
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

function asScoredRecord(row: Row): ScoredRecord {
  return {
    id: row.id,
    text: row.text,
    source: row.source,
    ...(row.metadata && Object.keys(row.metadata).length ? { metadata: row.metadata } : {}),
    score: Number(row.score),
  };
}

async function inTransaction<T>(db: Queryable, run: (tx: Queryable) => Promise<T>): Promise<T> {
  if (db.transaction) return db.transaction(run);
  const pool = db as PgPool;
  const fromPool = typeof pool.connect === 'function';
  const client = fromPool ? await pool.connect() : (db as PgConnection);
  if (!fromPool && !client.connection) {
    throw new Error('Filtered pgvector queries need a transaction-capable database connection for HNSW iterative scans.');
  }
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Keep the query error if the connection has already been lost.
    }
    throw error;
  } finally {
    if (fromPool) client.release?.();
  }
}
