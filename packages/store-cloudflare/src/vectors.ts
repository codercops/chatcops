import {
  matchesFilter,
  segmentWords,
  type KeywordQuery,
  type MetadataFilter,
  type ScoredRecord,
  type VectorQuery,
  type VectorRecord,
  type VectorStore,
} from '@chatcops/core';
import type { D1Database, VectorizeIndex } from './types.js';

interface VectorRow {
  id: string;
  source_id: string;
  text: string;
  source: string;
  metadata: string | null;
}

interface VectorMatch {
  id: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export class CloudflareVectors implements VectorStore {
  constructor(
    readonly dimensions: number,
    private readonly db: D1Database,
    private readonly index: VectorizeIndex,
    private readonly ensure: () => Promise<void>
  ) {}

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) this.checkVector(record.vector, `record ${record.id}`);
    await this.ensure();

    const statements = records.flatMap((record) => [
      this.db
        .prepare(`
          INSERT INTO chatcops_vectors (id, source_id, text, source, metadata)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            source_id = excluded.source_id,
            text = excluded.text,
            source = excluded.source,
            metadata = excluded.metadata
        `)
        .bind(record.id, record.source.id, record.text, JSON.stringify(record.source), JSON.stringify(record.metadata ?? null)),
      this.db.prepare('DELETE FROM chatcops_vectors_fts WHERE id = ?').bind(record.id),
      this.db
        .prepare('INSERT INTO chatcops_vectors_fts (id, text) VALUES (?, ?)')
        .bind(record.id, segmentWords(record.text).join(' ')),
    ]);
    await this.db.batch(statements);
    await this.index.upsert(
      records.map((record) => ({
        id: record.id,
        values: Array.from(record.vector),
        metadata: { ...(record.metadata ?? {}), sourceId: record.source.id },
      }))
    );
  }

  async query(query: VectorQuery): Promise<ScoredRecord[]> {
    this.checkVector(query.vector, 'the query');
    await this.ensure();
    const response = await this.index.query(Array.from(query.vector), {
      topK: Math.max(0, Math.floor(query.topK)),
      filter: toVectorizeFilter(query.filter),
      returnMetadata: true,
    });
    return this.recordsForMatches(response.matches ?? []);
  }

  async keywordQuery(query: KeywordQuery): Promise<ScoredRecord[]> {
    await this.ensure();
    const terms = segmentWords(query.text).join(' ');
    if (!terms) return [];
    const { results } = await this.db
      .prepare(`
        SELECT f.id, -bm25(chatcops_vectors_fts) AS score
        FROM chatcops_vectors_fts f
        WHERE f.text MATCH ?
        ORDER BY bm25(chatcops_vectors_fts), f.id
      `)
      .bind(terms)
      .all<{ id: string; score: number }>();
    const rows = await this.rowsByIds(results.map((row) => row.id));
    const matches = results
      .map((result) => ({ row: rows.get(result.id), score: Number(result.score) }))
      .filter((result): result is { row: VectorRow; score: number } => !!result.row && matchesFilter(parseMetadata(result.row.metadata), query.filter ?? {}))
      .slice(0, Math.max(0, Math.floor(query.topK)));
    return matches.map(({ row, score }) => toRecord(row, score));
  }

  async deleteBySource(sourceId: string): Promise<void> {
    await this.ensure();
    const { results } = await this.db.prepare('SELECT id FROM chatcops_vectors WHERE source_id = ?').bind(sourceId).all<{ id: string }>();
    if (!results.length) return;
    await this.index.deleteByIds(results.map((row) => row.id));
    await this.db.batch([
      this.db
        .prepare(`DELETE FROM chatcops_vectors_fts WHERE id IN (${results.map(() => '?').join(', ')})`)
        .bind(...results.map((row) => row.id)),
      this.db.prepare('DELETE FROM chatcops_vectors WHERE source_id = ?').bind(sourceId),
    ]);
  }

  private async recordsForMatches(matches: VectorMatch[]): Promise<ScoredRecord[]> {
    const rows = await this.rowsByIds(matches.map((match) => match.id));
    return matches.flatMap((match) => {
      const row = rows.get(match.id);
      return row ? [toRecord(row, Number(match.score ?? 0))] : [];
    });
  }

  private async rowsByIds(ids: string[]): Promise<Map<string, VectorRow>> {
    if (!ids.length) return new Map();
    const { results } = await this.db
      .prepare(`SELECT id, source_id, text, source, metadata FROM chatcops_vectors WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .bind(...ids)
      .all<VectorRow>();
    return new Map(results.map((row) => [row.id, row]));
  }

  private checkVector(vector: Float32Array, what: string): void {
    if (vector.length !== this.dimensions) throw new Error(`The vector for ${what} has ${vector.length} dimensions, but this store holds ${this.dimensions}.`);
    if (!vector.every(Number.isFinite)) throw new Error(`The vector for ${what} has a value that isn't a finite number.`);
  }
}

function parseMetadata(value: string | null): Record<string, import('@chatcops/core').MetadataValue> | undefined {
  return value ? JSON.parse(value) : undefined;
}

function toRecord(row: VectorRow, score: number): ScoredRecord {
  return { id: row.id, text: row.text, source: JSON.parse(row.source), ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}), score };
}

function toVectorizeFilter(filter: MetadataFilter | undefined): Record<string, unknown> | undefined {
  if (!filter) return undefined;
  return Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, Array.isArray(value) ? { $in: value } : { $eq: value }]));
}
