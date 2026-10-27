import { createRequire } from 'node:module';
import { segmentWords, type KeywordQuery, type MetadataFilter, type ScoredRecord, type VectorQuery, type VectorRecord, type VectorStore } from '@chatcops/core';
import { all, get, run, transaction, type SqliteDatabase } from './database.js';

interface Row { rowid: string; record: string; score: number }

/** Metadata predicates are evaluated before ranking; keys and values are bound. */
function predicate(filter?: MetadataFilter): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses = Object.entries(filter ?? {}).map(([key, wanted]) => {
    const values = Array.isArray(wanted) ? wanted : [wanted];
    if (!values.length) return '0';
    const alternatives = values.map((value) => {
      params.push(key);
      if (typeof value === 'boolean') {
        params.push(value ? 'true' : 'false');
        return '(m.key = ? AND m.type = ?)';
      }
      params.push(value);
      return `(m.key = ? AND m.type ${typeof value === 'number' ? "IN ('integer', 'real')" : "= 'text'"} AND m.value = ?)`;
    });
    return `EXISTS (SELECT 1 FROM json_each(json_extract(r.record, '$.metadata')) m WHERE ${alternatives.join(' OR ')})`;
  });
  return { sql: clauses.length ? clauses.join(' AND ') : '1', params };
}

export class SqliteVectors implements VectorStore {
  constructor(private readonly db: SqliteDatabase, readonly dimensions: number) {
    if (!Number.isSafeInteger(dimensions) || dimensions < 1) throw new Error('Vector dimensions must be a positive integer');
    const require = createRequire(import.meta.url);
    const { getLoadablePath } = require('sqlite-vec') as { getLoadablePath(): string };
    if (!db.loadExtension) throw new Error('Vectors require a database opened with allowExtension: true and loadExtension support');
    db.loadExtension(getLoadablePath());
    db.exec(`
      CREATE TABLE IF NOT EXISTS chatcops_vector_config (dimensions INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS chatcops_vector_records (rowid INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, source_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS chatcops_vector_source ON chatcops_vector_records(source_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS chatcops_vectors USING vec0(embedding float[${dimensions}] distance_metric=cosine);
      CREATE VIRTUAL TABLE IF NOT EXISTS chatcops_vector_fts USING fts5(words);
    `);
    const config = get<{ dimensions: number }>(db, 'SELECT dimensions FROM chatcops_vector_config');
    if (config && config.dimensions !== dimensions) throw new Error(`SQLite vectors have ${config.dimensions} dimensions, requested ${dimensions}`);
    if (!config) run(db, 'INSERT INTO chatcops_vector_config VALUES (?)', dimensions);
  }

  private check(vector: Float32Array): void {
    if (vector.length !== this.dimensions || !vector.every(Number.isFinite)) throw new Error(`Expected ${this.dimensions} finite vector dimensions`);
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) this.check(record.vector);
    transaction(this.db, () => {
      for (const { vector, ...record } of records) {
        const row = get<{ rowid: string }>(this.db,
          'INSERT INTO chatcops_vector_records (id, source_id, record) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id, record=excluded.record RETURNING CAST(rowid AS TEXT) AS rowid',
          record.id, record.source.id, JSON.stringify(record));
        if (!row) throw new Error('Vector upsert returned no row');
        const rowid = BigInt(row.rowid);
        run(this.db, 'DELETE FROM chatcops_vectors WHERE rowid = ?', rowid);
        run(this.db, 'INSERT INTO chatcops_vectors(rowid, embedding) VALUES (?, ?)', rowid, JSON.stringify(Array.from(vector)));
        run(this.db, 'DELETE FROM chatcops_vector_fts WHERE rowid = ?', rowid);
        run(this.db, 'INSERT INTO chatcops_vector_fts(rowid, words) VALUES (?, ?)', rowid, segmentWords(record.text).join(' '));
      }
    });
  }

  async query({ vector, topK, filter }: VectorQuery): Promise<ScoredRecord[]> {
    this.check(vector);
    if (!(topK >= 1)) return [];
    const where = predicate(filter);
    const rows = all<Row>(this.db, `SELECT r.record, CASE WHEN vec_distance_cosine(v.embedding, ?) IS NULL THEN 0 ELSE 1 - vec_distance_cosine(v.embedding, ?) END AS score
      FROM chatcops_vector_records r JOIN chatcops_vectors v ON v.rowid=r.rowid
      WHERE ${where.sql} ORDER BY score DESC, r.id LIMIT ?`,
      JSON.stringify(Array.from(vector)), JSON.stringify(Array.from(vector)), ...where.params, Math.floor(topK));
    return rows.map((row) => ({ ...JSON.parse(row.record), score: row.score }));
  }

  async keywordQuery({ text, topK, filter }: KeywordQuery): Promise<ScoredRecord[]> {
    const words = [...new Set(segmentWords(text))];
    if (!words.length || !(topK >= 1)) return [];
    const where = predicate(filter);
    const rows = all<Row>(this.db, `SELECT r.record, -bm25(chatcops_vector_fts) AS score
      FROM chatcops_vector_fts JOIN chatcops_vector_records r ON r.rowid=chatcops_vector_fts.rowid
      WHERE chatcops_vector_fts MATCH ? AND ${where.sql} ORDER BY score DESC, r.id LIMIT ?`,
      words.map((word) => `"${word.replaceAll('"', '""')}"`).join(' OR '), ...where.params, Math.floor(topK));
    return rows.map((row) => ({ ...JSON.parse(row.record), score: row.score }));
  }

  async deleteBySource(sourceId: string): Promise<void> {
    transaction(this.db, () => {
      for (const row of all<Row>(this.db, 'SELECT CAST(rowid AS TEXT) AS rowid FROM chatcops_vector_records WHERE source_id = ?', sourceId)) {
        run(this.db, 'DELETE FROM chatcops_vectors WHERE rowid = ?', BigInt(row.rowid));
        run(this.db, 'DELETE FROM chatcops_vector_fts WHERE rowid = ?', row.rowid);
      }
      run(this.db, 'DELETE FROM chatcops_vector_records WHERE source_id = ?', sourceId);
    });
  }
}
