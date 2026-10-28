import type {
  KeywordQuery,
  MetadataFilter,
  MetadataValue,
  ScoredRecord,
  VectorQuery,
  VectorRecord,
  VectorStore,
} from './types.js';

export interface MemoryVectorsOptions {
  /** The length of every vector, set by the embedder (1024 for the default). */
  dimensions: number;
  /** Upserts that would go past this many records fail. Default 50,000. */
  maxRecords?: number;
}

interface Stored {
  record: Omit<VectorRecord, 'vector'>;
  vector: Float32Array;
  norm: number;
  /** Term counts for keyword search. */
  terms: Map<string, number>;
  length: number;
}

// BM25's usual constants.
const K1 = 1.2;
const B = 0.75;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

/**
 * The words in a text, lowercased. `Intl.Segmenter` finds word boundaries in
 * languages written without spaces (Japanese, Chinese, Thai), where splitting
 * on whitespace would make a whole sentence one word.
 */
export function segmentWords(text: string): string[] {
  const words: string[] = [];
  for (const part of segmenter.segment(text.normalize('NFKC').toLowerCase())) {
    if (part.isWordLike) words.push(part.segment);
  }
  return words;
}

/**
 * Vectors kept in this process, searched by comparing against every record.
 * Fine for tests, local development and a few thousand chunks; use a store
 * package with a vector index for more.
 */
export function memoryVectors(options: MemoryVectorsOptions): VectorStore {
  const { dimensions } = options;
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new Error(`memoryVectors needs dimensions as a positive whole number, got ${dimensions}.`);
  }
  return new MemoryVectorStore(dimensions, options.maxRecords ?? 50_000);
}

class MemoryVectorStore implements VectorStore {
  private readonly records = new Map<string, Stored>();

  constructor(
    readonly dimensions: number,
    private readonly maxRecords: number
  ) {}

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) this.checkVector(record.vector, `record ${record.id}`);
    const added = new Set(records.map((record) => record.id).filter((id) => !this.records.has(id))).size;
    if (this.records.size + added > this.maxRecords) {
      throw new Error(
        `memoryVectors holds at most ${this.maxRecords} records, and this upsert would make ${this.records.size + added}. Use a store package for an index this size.`
      );
    }
    for (const { vector, ...rest } of records) {
      const copy = Float32Array.from(vector);
      const words = segmentWords(rest.text);
      const terms = new Map<string, number>();
      for (const word of words) terms.set(word, (terms.get(word) ?? 0) + 1);
      this.records.set(rest.id, {
        record: structuredClone(rest),
        vector: copy,
        norm: length(copy),
        terms,
        length: words.length,
      });
    }
  }

  async query({ vector, topK, filter }: VectorQuery): Promise<ScoredRecord[]> {
    this.checkVector(vector, 'the query');
    const norm = length(vector);
    const scored: Array<[Stored, number]> = [];
    for (const stored of this.matching(filter)) {
      let dot = 0;
      for (let i = 0; i < vector.length; i++) dot += vector[i] * stored.vector[i];
      scored.push([stored, norm === 0 || stored.norm === 0 ? 0 : dot / (norm * stored.norm)]);
    }
    return best(scored, topK);
  }

  async keywordQuery({ text, topK, filter }: KeywordQuery): Promise<ScoredRecord[]> {
    const words = [...new Set(segmentWords(text))];
    const candidates = [...this.matching(filter)];
    if (words.length === 0 || candidates.length === 0) return [];
    const averageLength = candidates.reduce((sum, stored) => sum + stored.length, 0) / candidates.length || 1;
    const scored: Array<[Stored, number]> = [];
    const idf = new Map(
      words.map((word) => {
        const withWord = candidates.filter((stored) => stored.terms.has(word)).length;
        return [word, Math.log(1 + (candidates.length - withWord + 0.5) / (withWord + 0.5))];
      })
    );
    for (const stored of candidates) {
      let score = 0;
      for (const word of words) {
        const count = stored.terms.get(word);
        if (!count) continue;
        score += (idf.get(word) ?? 0) * ((count * (K1 + 1)) / (count + K1 * (1 - B + (B * stored.length) / averageLength)));
      }
      if (score > 0) scored.push([stored, score]);
    }
    return best(scored, topK);
  }

  async deleteBySource(sourceId: string): Promise<void> {
    for (const [id, stored] of this.records) {
      if (stored.record.source.id === sourceId) this.records.delete(id);
    }
  }

  private *matching(filter: MetadataFilter | undefined): Iterable<Stored> {
    for (const stored of this.records.values()) {
      if (!filter || matchesFilter(stored.record.metadata, filter)) yield stored;
    }
  }

  private checkVector(vector: Float32Array, what: string): void {
    if (vector.length !== this.dimensions) {
      throw new Error(`The vector for ${what} has ${vector.length} dimensions, but this store holds ${this.dimensions}.`);
    }
    if (!vector.every(Number.isFinite)) throw new Error(`The vector for ${what} has a value that isn't a finite number.`);
  }
}

function length(vector: Float32Array): number {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

/** Whether metadata passes a filter, by the rules on `MetadataFilter`. */
export function matchesFilter(metadata: Record<string, MetadataValue> | undefined, filter: MetadataFilter): boolean {
  return Object.entries(filter).every(([key, wanted]) => {
    if (!metadata || !Object.hasOwn(metadata, key)) return false;
    const value = metadata[key];
    return Array.isArray(wanted) ? wanted.includes(value) : wanted === value;
  });
}

/** The `topK` highest scores, best first, ties broken by id so results are stable. */
function best(scored: Array<[Stored, number]>, topK: number): ScoredRecord[] {
  if (!(topK >= 1)) return [];
  return scored
    .sort(([a, x], [b, y]) => y - x || (a.record.id < b.record.id ? -1 : 1))
    .slice(0, Math.floor(topK))
    .map(([stored, score]) => ({ ...structuredClone(stored.record), score }));
}
