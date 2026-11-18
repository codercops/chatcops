import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromNeon, migrate, migrateVectors, MIGRATIONS, postgresStorage, tableNames } from '../src/index.js';

const url = process.env.CHATCOPS_TEST_POSTGRES_URL;
const run = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe.runIf(url)('postgresStorage', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });

  afterAll(async () => {
    // Drop the tables this file created under its own prefixes.
    const { rows } = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE $1",
      [`${run}%`]
    );
    for (const { tablename } of rows) await pool.query(`DROP TABLE IF EXISTS ${tablename} CASCADE`);
    await pool.end();
  });

  it('migrates once and then has nothing to do', async () => {
    const tablePrefix = `${run}_m_`;
    expect(await migrate(pool, { tablePrefix })).toEqual({ applied: MIGRATIONS.map((m) => m.id) });
    expect(await migrate(pool, { tablePrefix })).toEqual({ applied: [] });
  });

  it('creates the optional vector table idempotently under the configured prefix', async () => {
    const tablePrefix = `${run}_vec_`;
    await migrateVectors(pool, { dimensions: 4, tablePrefix });
    await expect(migrateVectors(pool, { dimensions: 4, tablePrefix })).resolves.toBeUndefined();
    const t = tableNames(tablePrefix);
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT to_regclass($1) AS table_name`,
      [t.vectorChunks]
    );
    expect(rows[0]?.table_name).toBe(t.vectorChunks);
  });

  it('keeps apps with different table prefixes apart', async () => {
    const a = postgresStorage({ db: pool, tablePrefix: `${run}_a_` });
    const b = postgresStorage({ db: pool, tablePrefix: `${run}_b_` });
    await migrate(pool, { tablePrefix: `${run}_a_` });
    await migrate(pool, { tablePrefix: `${run}_b_` });

    await a.conversations.append?.('same-id', [{ id: 'u1', role: 'user', content: 'from a', timestamp: 1 }]);
    await a.counters?.increment('k', 1, 60_000);
    await a.kv?.set('k', 'a');

    expect(await b.conversations.get('same-id')).toBeNull();
    expect(await b.counters?.get('k')).toBeNull();
    expect(await b.kv?.get('k')).toBeNull();
  });

  it('keeps message fields it has no column for', async () => {
    const tablePrefix = `${run}_x_`;
    await migrate(pool, { tablePrefix });
    const storage = postgresStorage({ db: pool, tablePrefix });
    const message = { id: 'm1', role: 'user' as const, content: 'hi', timestamp: 5, futureField: { x: 1 } };
    await storage.conversations.append?.('c1', [message]);
    expect((await storage.conversations.get('c1'))?.messages[0]).toEqual(message);
  });

  it('counts fractions, so a budget can be in cents', async () => {
    const tablePrefix = `${run}_f_`;
    await migrate(pool, { tablePrefix });
    const counters = postgresStorage({ db: pool, tablePrefix }).counters;
    await counters?.increment('usd', 0.25, 60_000);
    expect((await counters?.increment('usd', 0.5, 60_000))?.value).toBe(0.75);
  });

  it('clears expired counters and keys when purging', async () => {
    const tablePrefix = `${run}_p_`;
    await migrate(pool, { tablePrefix });
    let now = 1_000_000;
    const storage = postgresStorage({ db: pool, tablePrefix, now: () => now });
    await storage.counters?.increment('old', 1, 10);
    await storage.kv?.set('old', 1, { ttlMs: 10 });
    await storage.kv?.set('forever', 1);
    now += 100;
    await storage.conversations.purge?.(0);

    const t = tableNames(tablePrefix);
    const counters = await pool.query(`SELECT key FROM ${t.counters}`);
    const keys = await pool.query(`SELECT key FROM ${t.kv}`);
    expect(counters.rows).toEqual([]);
    expect(keys.rows.map((r) => r.key)).toEqual(['forever']);
  });

  it('counts events by hour, across types, and stores undefined as null', async () => {
    const tablePrefix = `${run}_e_`;
    await migrate(pool, { tablePrefix });
    const storage = postgresStorage({ db: pool, tablePrefix });
    const hour = Date.UTC(2026, 9, 20, 10);
    await storage.events?.write([
      { type: 'b', timestamp: hour + 1 },
      { type: 'a', timestamp: hour + 2, data: { conversationId: 'c1' } },
      { type: 'a', timestamp: hour + 60 * 60 * 1000 },
    ]);
    expect(await storage.events?.query?.({ from: hour, to: hour + 2 * 60 * 60 * 1000, groupBy: 'hour' })).toEqual([
      { bucket: hour, type: 'a', count: 1 },
      { bucket: hour, type: 'b', count: 1 },
      { bucket: hour + 60 * 60 * 1000, type: 'a', count: 1 },
    ]);

    await storage.kv?.set('nothing', undefined);
    expect(await storage.kv?.get('nothing')).toBeNull();
  });

  it('lists only conversations updated after a time, and handles empty writes', async () => {
    const tablePrefix = `${run}_l_`;
    await migrate(pool, { tablePrefix });
    let now = 1_000;
    const store = postgresStorage({ db: pool, tablePrefix, now: () => now }).conversations;
    await store.append?.('old', [{ id: 'u1', role: 'user', content: 'hi', timestamp: 1 }]);
    now = 5_000;
    await store.append?.('new', []);
    await store.save({ id: 'saved', messages: [], createdAt: 1, updatedAt: 1 });

    const page = await store.list?.({ limit: 10, updatedAfter: 2_000 });
    expect(page?.items.map((item) => item.id).sort()).toEqual(['new', 'saved']);
    expect((await store.get('new'))?.messages).toEqual([]);
  });

  it('refuses a cursor it did not make', async () => {
    const tablePrefix = `${run}_c_`;
    await migrate(pool, { tablePrefix });
    const store = postgresStorage({ db: pool, tablePrefix }).conversations;
    await expect(store.list?.({ limit: 1, cursor: 'nonsense' })).rejects.toThrow('Not a list cursor');
  });
});

describe('table prefixes', () => {
  it('only accepts plain identifiers, since they go into SQL', () => {
    expect(tableNames('app_').conversations).toBe('app_conversations');
    expect(() => tableNames('x; DROP TABLE users; --')).toThrow('tablePrefix');
    expect(() => tableNames('Mixed')).toThrow('tablePrefix');
  });
});

describe('fromNeon', () => {
  it('accepts the rows array the Neon driver returns, or a result with rows', async () => {
    const array = fromNeon({ query: async () => [{ a: 1 }] });
    const full = fromNeon({ query: async () => ({ rows: [{ a: 2 }] }) });
    expect((await array.query('SELECT 1')).rows).toEqual([{ a: 1 }]);
    expect((await full.query('SELECT 1')).rows).toEqual([{ a: 2 }]);
  });
});
