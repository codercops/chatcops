import { segmentWords, type KeywordQuery, type MetadataFilter, type MetadataValue, type ScoredRecord, type VectorQuery, type VectorRecord, type VectorStore } from '@chatcops/core';
import { QueryMode, type Index } from '@upstash/vector';

const SOURCE_ID = '__chatcops_source_id';
const SOURCE_URL = '__chatcops_source_url';
const SOURCE_TITLE = '__chatcops_source_title';
const SOURCE_SECTION = '__chatcops_source_section';
const SOURCE_UPDATED_AT = '__chatcops_source_updated_at';

type UpstashMetadata = Record<string, string | number | boolean>;

/** Creates ChatCops vector storage backed by an Upstash Vector index. */
export interface UpstashVectorsOptions {
  index: Index<UpstashMetadata>;
  dimensions: number;
  /** Set for a sparse index or hybrid index with a sparse text embedding model. */
  keywordSearch?: boolean;
}

export function upstashVectors(options: UpstashVectorsOptions): VectorStore {
  const { index, dimensions, keywordSearch = false } = options;
  if (!index) throw new TypeError('upstashVectors requires an Upstash Vector index');
  if (!Number.isInteger(dimensions) || dimensions < 1) throw new Error(`dimensions must be a positive whole number; got ${dimensions}.`);
  return new UpstashVectorStore(index, dimensions, keywordSearch);
}

class UpstashVectorStore implements VectorStore {
  readonly keywordQuery?: (query: KeywordQuery) => Promise<ScoredRecord[]>;

  constructor(private readonly index: Index<UpstashMetadata>, readonly dimensions: number, keywordSearch: boolean) {
    if (keywordSearch) this.keywordQuery = this.searchKeywords.bind(this);
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) checkVector(record.vector, this.dimensions, `record ${record.id}`);
    if (!records.length) return;
    await this.index.upsert<UpstashMetadata>(records.map((record) => ({
      id: record.id,
      vector: Array.from(record.vector),
      data: record.text,
      metadata: toMetadata(record),
    })));
  }

  async query({ vector, topK, filter }: VectorQuery): Promise<ScoredRecord[]> {
    checkVector(vector, this.dimensions, 'the query');
    const limit = limitFor(topK);
    if (!limit) return [];
    const results = await this.index.query<UpstashMetadata>({
      vector: Array.from(vector), topK: limit, includeMetadata: true, includeData: true,
      ...(filter && Object.keys(filter).length ? { filter: serializeFilter(filter) } : {}),
    });
    return results.map((result) => fromResult(result));
  }

  async deleteBySource(sourceId: string): Promise<void> {
    await this.index.delete({ filter: `${SOURCE_ID} = ${quoteString(sourceId)}` });
  }

  private async searchKeywords({ text, topK, filter }: KeywordQuery): Promise<ScoredRecord[]> {
    const limit = limitFor(topK);
    const words = segmentWords(text).join(' ');
    if (!limit || !words) return [];
    const results = await this.index.query<UpstashMetadata>({
      data: words,
      topK: limit,
      queryMode: QueryMode.SPARSE,
      includeMetadata: true,
      includeData: true,
      ...(filter && Object.keys(filter).length ? { filter: serializeFilter(filter) } : {}),
    });
    return results.map((result) => fromResult(result, false));
  }
}

function checkVector(vector: Float32Array, dimensions: number, what: string): void {
  if (vector.length !== dimensions) throw new Error(`The vector for ${what} has ${vector.length} dimensions, but this store holds ${dimensions}.`);
  if (!vector.every(Number.isFinite)) throw new Error(`The vector for ${what} has a value that isn't a finite number.`);
}

function limitFor(topK: number): number {
  return Number.isFinite(topK) && topK >= 1 ? Math.floor(topK) : 0;
}

function toMetadata(record: VectorRecord): UpstashMetadata {
  const metadata: UpstashMetadata = { ...(record.metadata ?? {}) };
  for (const key of [SOURCE_ID, SOURCE_URL, SOURCE_TITLE, SOURCE_SECTION, SOURCE_UPDATED_AT]) {
    if (Object.hasOwn(metadata, key)) throw new Error(`Metadata key ${key} is reserved by @chatcops/store-upstash-vector.`);
  }
  metadata[SOURCE_ID] = record.source.id;
  metadata[SOURCE_URL] = record.source.url;
  if (record.source.title !== undefined) metadata[SOURCE_TITLE] = record.source.title;
  if (record.source.section !== undefined) metadata[SOURCE_SECTION] = record.source.section;
  if (record.source.updatedAt !== undefined) metadata[SOURCE_UPDATED_AT] = record.source.updatedAt;
  return metadata;
}

function fromResult(result: { id: string | number; score: number; data?: string; metadata?: UpstashMetadata }, cosine = true): ScoredRecord {
  const metadata = { ...(result.metadata ?? {}) };
  const source = {
    id: String(metadata[SOURCE_ID] ?? ''),
    url: String(metadata[SOURCE_URL] ?? ''),
    ...(typeof metadata[SOURCE_TITLE] === 'string' ? { title: metadata[SOURCE_TITLE] } : {}),
    ...(typeof metadata[SOURCE_SECTION] === 'string' ? { section: metadata[SOURCE_SECTION] } : {}),
    ...(typeof metadata[SOURCE_UPDATED_AT] === 'number' ? { updatedAt: metadata[SOURCE_UPDATED_AT] } : {}),
  };
  for (const key of [SOURCE_ID, SOURCE_URL, SOURCE_TITLE, SOURCE_SECTION, SOURCE_UPDATED_AT]) delete metadata[key];
  return {
    id: String(result.id), text: result.data ?? '', source,
    ...(Object.keys(metadata).length ? { metadata } : {}),
    // Dense cosine scores use [-1, 1]; sparse scores are backend-specific BM25-style values.
    score: cosine ? Math.round((result.score * 2 - 1) * 1e12) / 1e12 : result.score,
  };
}

/** Serializes the MetadataFilter grammar supported by Upstash Vector. */
export function serializeFilter(filter: MetadataFilter): string {
  return Object.entries(filter).map(([key, wanted]) => {
    const field = quoteField(key);
    const values: MetadataValue[] = Array.isArray(wanted) ? wanted : [wanted];
    if (!values.length) return `${field} = '__chatcops_no_match__' AND ${field} != '__chatcops_no_match__'`;
    return `(${values.map((value) => `${field} = ${serializeValue(value)}`).join(' OR ')})`;
  }).join(' AND ');
}

function quoteField(field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) throw new Error(`Unsupported Upstash metadata field name: ${field}`);
  return field;
}

function serializeValue(value: MetadataValue): string {
  if (typeof value === 'string') return quoteString(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function quoteString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}
