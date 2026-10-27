import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { ChatCopsCounter, D1Database, DurableObjectNamespace, VectorizeIndex } from '../src/index.js';

class FakeVectorize implements VectorizeIndex {
  private readonly records = new Map<string, { values: number[]; metadata?: Record<string, unknown> }>();

  async upsert(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>): Promise<void> {
    for (const vector of vectors) this.records.set(vector.id, { values: [...vector.values], metadata: structuredClone(vector.metadata) });
  }

  async query(vector: number[], options: { topK: number; filter?: Record<string, unknown> }): Promise<{ matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }> {
    const matches = [...this.records.entries()]
      .filter(([, record]) => !options.filter || Object.entries(options.filter).every(([key, condition]) => {
        const value = record.metadata?.[key];
        if (typeof condition !== 'object' || condition === null) return value === condition;
        if ('$eq' in condition) return value === (condition as { $eq: unknown }).$eq;
        return Array.isArray((condition as { $in?: unknown[] }).$in) && (condition as { $in: unknown[] }).$in.includes(value);
      }))
      .map(([id, record]) => ({ id, score: cosine(vector, record.values), metadata: structuredClone(record.metadata) }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, Math.floor(options.topK));
    return { matches };
  }

  async deleteByIds(ids: string[]): Promise<void> {
    for (const id of ids) this.records.delete(id);
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aLength = 0;
  let bLength = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aLength += a[i] * a[i];
    bLength += b[i] * b[i];
  }
  return aLength && bLength ? dot / Math.sqrt(aLength * bLength) : 0;
}

let mf: Miniflare | undefined;
let d1Instance: D1Database | undefined;
let countersInstance: DurableObjectNamespace<ChatCopsCounter> | undefined;
let vectorizeInstance: VectorizeIndex | undefined;

export async function getMiniflareBindings() {
  if (!mf) {
    const countersPath = new URL('../dist/counters.js', import.meta.url);
    const countersSource = readFileSync(countersPath, 'utf8');

    mf = new Miniflare({
      name: 'test-worker',
      compatibilityDate: '2026-07-30',
      compatibilityFlags: ['nodejs_compat'],
      modules: [
        {
          type: 'ESModule',
          path: 'index.js',
          contents: `
            export { ChatCopsCounter } from './counters.js';
            export default {
              fetch() { return new Response('ok'); }
            };
          `,
        },
        {
          type: 'ESModule',
          path: 'counters.js',
          contents: countersSource,
        },
      ],
      d1Databases: ['DB'],
      durableObjects: {
        COUNTERS: {
          className: 'ChatCopsCounter',
          useSQLite: true,
        },
      },
      unsafeInspectDurableObjects: true,
    });
    await mf.ready;
    d1Instance = (await mf.getD1Database('DB')) as unknown as D1Database;
    countersInstance = (await mf.getDurableObjectNamespace('COUNTERS')) as unknown as DurableObjectNamespace<ChatCopsCounter>;
  }
  if (!d1Instance || !countersInstance) {
    throw new Error('Failed to initialize Miniflare bindings');
  }
  vectorizeInstance ??= new FakeVectorize();
  return { mf, d1: d1Instance, counters: countersInstance, vectorize: vectorizeInstance };
}

export async function disposeMiniflare() {
  await mf?.dispose();
  mf = undefined;
  vectorizeInstance = undefined;
}
