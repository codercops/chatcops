import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sqliteStorage, type RowHookFunction } from '../src/index.js';

const workspace = '6f1c2a5e-8f2b-4d1a-9c3e-2b7a1d4e5f60';
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

/** A database with the tenant columns the cloud's own migration adds. */
function setup(rowHook: RowHookFunction = ({ metadata }) => ({ workspace_id: metadata?.workspaceId, site_id: metadata?.siteId })) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  sqliteStorage({ database });
  for (const table of ['chatcops_conversations', 'chatcops_messages']) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id TEXT`);
    database.exec(`ALTER TABLE ${table} ADD COLUMN site_id TEXT`);
  }
  const hook = vi.fn(rowHook);
  const store = sqliteStorage({ database, extraColumns: { workspace_id: 'uuid', site_id: 'text' }, rowHook: hook }).conversations;
  const rows = (sql: string) => database.prepare(sql).all().map((row) => ({ ...row }));
  return { store, hook, rows };
}

describe('rowHook and extraColumns', () => {
  it('stamps new conversation and message rows from the metadata', async () => {
    const { store, hook, rows } = setup();
    await store.append?.('c1', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }], {
      metadata: { workspaceId: workspace, siteId: 'site-1' },
    });

    expect(rows(`SELECT workspace_id, site_id FROM chatcops_conversations WHERE id = 'c1'`)).toEqual([{ workspace_id: workspace, site_id: 'site-1' }]);
    expect(rows(`SELECT workspace_id, site_id FROM chatcops_messages WHERE conversation_id = 'c1'`)).toEqual([{ workspace_id: workspace, site_id: 'site-1' }]);
    expect(hook).toHaveBeenCalledWith(expect.objectContaining({ table: 'messages', conversationId: 'c1', message: expect.objectContaining({ id: 'u1' }) }));
  });

  it('only stamps on insert: a later append or save leaves the conversation row alone', async () => {
    const { store, rows } = setup();
    await store.append?.('c2', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }], { metadata: { workspaceId: workspace, siteId: 'first' } });
    await store.append?.('c2', [{ id: 'u2', role: 'user', content: 'Again', timestamp: 2 }], { metadata: { siteId: 'second' } });
    expect(rows(`SELECT site_id FROM chatcops_conversations WHERE id = 'c2'`)).toEqual([{ site_id: 'first' }]);
    expect(rows(`SELECT site_id FROM chatcops_messages WHERE conversation_id = 'c2' ORDER BY seq`)).toEqual([{ site_id: 'first' }, { site_id: 'second' }]);

    const conversation = await store.get('c2');
    if (!conversation) throw new Error('c2 was not stored');
    await store.save({ ...conversation, metadata: { siteId: 'third' } });
    expect(rows(`SELECT site_id FROM chatcops_conversations WHERE id = 'c2'`)).toEqual([{ site_id: 'first' }]);
  });

  it('binds values as parameters, never as SQL, and stores booleans as 1 or 0', async () => {
    const { store, rows } = setup(({ metadata }) => ({ site_id: metadata?.siteId, workspace_id: true }));
    const sneaky = "x'); DROP TABLE chatcops_messages; --";
    await store.save({ id: 'c3', messages: [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }], metadata: { siteId: sneaky }, createdAt: 1, updatedAt: 1 });
    expect(rows(`SELECT site_id, workspace_id FROM chatcops_messages WHERE conversation_id = 'c3'`)).toEqual([{ site_id: sneaky, workspace_id: '1' }]);
  });

  it('refuses a key that is not declared, and stores nothing from that write', async () => {
    const { store } = setup(() => ({ tenant: 'x' }));
    await expect(store.append?.('c4', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }])).rejects.toThrow(
      'rowHook returned "tenant", which isn\'t in extraColumns'
    );
    expect(await store.get('c4')).toBeNull();
  });

  it('refuses a value SQLite cannot store', async () => {
    const { store } = setup(() => ({ site_id: { nested: true } }));
    await expect(store.append?.('c5', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }])).rejects.toThrow(
      'rowHook returned an unsupported value (object) for "site_id"'
    );
  });
});

describe('extraColumns checks', () => {
  it('needs both options or neither', () => {
    expect(() => sqliteStorage({ path: ':memory:', extraColumns: ['a'] })).toThrow('both extraColumns and rowHook');
    expect(() => sqliteStorage({ path: ':memory:', rowHook: () => ({}) })).toThrow('both extraColumns and rowHook');
  });

  it("only takes plain column names, and not the store's own columns", () => {
    const rowHook = () => ({});
    expect(() => sqliteStorage({ path: ':memory:', extraColumns: ['bad name'], rowHook })).toThrow('plain lowercase column name');
    expect(() => sqliteStorage({ path: ':memory:', extraColumns: ['message'], rowHook })).toThrow("store's own columns");
  });
});
