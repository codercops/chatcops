import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrate, postgresStorage, tableNames } from '../src/index.js';

const url = process.env.CHATCOPS_TEST_POSTGRES_URL;
const tablePrefix = `hook${Date.now().toString(36)}_`;
const t = tableNames(tablePrefix);

describe.runIf(url)('rowHook and extraColumns', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await migrate(pool, { tablePrefix });
    // What the cloud's own migration adds.
    for (const table of [t.conversations, t.messages]) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN workspace_id uuid, ADD COLUMN site_id text`);
    }
  });

  afterAll(async () => {
    for (const table of Object.values(t)) await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    await pool.end();
  });

  const workspace = '6f1c2a5e-8f2b-4d1a-9c3e-2b7a1d4e5f60';

  function storage(rowHook = vi.fn(({ metadata }) => ({ workspace_id: metadata?.workspaceId, site_id: metadata?.siteId }))) {
    return {
      rowHook,
      store: postgresStorage({ db: pool, tablePrefix, extraColumns: { workspace_id: 'uuid', site_id: 'text' }, rowHook }).conversations,
    };
  }

  it('stamps new conversation and message rows from the metadata', async () => {
    const { store, rowHook } = storage();
    await store.append?.('c1', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }], {
      metadata: { workspaceId: workspace, siteId: 'site-1' },
    });

    const conversation = await pool.query(`SELECT workspace_id, site_id FROM ${t.conversations} WHERE id = 'c1'`);
    const messages = await pool.query(`SELECT workspace_id, site_id FROM ${t.messages} WHERE conversation_id = 'c1'`);
    expect(conversation.rows).toEqual([{ workspace_id: workspace, site_id: 'site-1' }]);
    expect(messages.rows).toEqual([{ workspace_id: workspace, site_id: 'site-1' }]);
    expect(rowHook).toHaveBeenCalledWith(expect.objectContaining({ table: 'messages', conversationId: 'c1', message: expect.objectContaining({ id: 'u1' }) }));
  });

  it('only stamps on insert: a later append leaves the conversation row alone', async () => {
    const { store } = storage();
    await store.append?.('c2', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }], { metadata: { workspaceId: workspace, siteId: 'first' } });
    await store.append?.('c2', [{ id: 'u2', role: 'user', content: 'Again', timestamp: 2 }], { metadata: { siteId: 'second' } });

    const conversation = await pool.query(`SELECT site_id FROM ${t.conversations} WHERE id = 'c2'`);
    expect(conversation.rows[0].site_id).toBe('first');
  });

  it('binds values as parameters, never as SQL', async () => {
    const { store } = storage();
    const sneaky = "x'); DROP TABLE users; --";
    await store.save({ id: 'c3', messages: [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }], metadata: { siteId: sneaky }, createdAt: 1, updatedAt: 1 });
    const row = await pool.query(`SELECT site_id FROM ${t.messages} WHERE conversation_id = 'c3'`);
    expect(row.rows[0].site_id).toBe(sneaky);
  });

  it('refuses a key that is not declared', async () => {
    const { store } = storage(vi.fn(() => ({ tenant: 'x' })));
    await expect(store.append?.('c4', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }])).rejects.toThrow(
      'rowHook returned "tenant", which isn\'t in extraColumns'
    );
    expect(await store.get('c4')).toBeNull();
  });
});

describe('extraColumns checks', () => {
  const db = { query: async () => ({ rows: [] }) };
  it('needs both options or neither', () => {
    expect(() => postgresStorage({ db, extraColumns: ['a'] })).toThrow('both extraColumns and rowHook');
  });
  it('only takes plain column names and type names, and not the store own columns', () => {
    const rowHook = () => ({});
    expect(() => postgresStorage({ db, extraColumns: ['bad name'], rowHook })).toThrow('plain lowercase column name');
    expect(() => postgresStorage({ db, extraColumns: { a: 'text; DROP' }, rowHook })).toThrow("isn't a SQL type name");
    expect(() => postgresStorage({ db, extraColumns: ['version'], rowHook })).toThrow("store's own columns");
  });
});
