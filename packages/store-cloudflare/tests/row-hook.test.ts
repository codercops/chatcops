import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloudflareStorage, type D1Database, type RowHookFunction } from '../src/index.js';
import { disposeMiniflare, getMiniflareBindings } from './miniflare.js';

const workspace = '6f1c2a5e-8f2b-4d1a-9c3e-2b7a1d4e5f60';
let d1: D1Database;

beforeAll(async () => {
  d1 = (await getMiniflareBindings()).d1;
  // Creates the tables, then adds the columns the cloud's own migration adds.
  await cloudflareStorage({ d1 }).conversations.get('warm-up');
  for (const table of ['chatcops_conversations', 'chatcops_messages']) {
    await d1.prepare(`ALTER TABLE ${table} ADD COLUMN workspace_id TEXT`).run();
    await d1.prepare(`ALTER TABLE ${table} ADD COLUMN site_id TEXT`).run();
    await d1.prepare(`ALTER TABLE ${table} ADD COLUMN trial INTEGER`).run();
  }
});

afterAll(async () => {
  await disposeMiniflare();
});

function setup(rowHook: RowHookFunction = ({ metadata }) => ({ workspace_id: metadata?.workspaceId, site_id: metadata?.siteId })) {
  const hook = vi.fn(rowHook);
  const store = cloudflareStorage({ d1, extraColumns: { workspace_id: 'uuid', site_id: 'text' }, rowHook: hook }).conversations;
  return { store, hook };
}

async function rows(sql: string) {
  return (await d1.prepare(sql).all<Record<string, unknown>>()).results;
}

describe('rowHook and extraColumns', () => {
  it('stamps new conversation and message rows from the metadata', async () => {
    const { store, hook } = setup();
    await store.append?.('c1', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }], {
      metadata: { workspaceId: workspace, siteId: 'site-1' },
    });

    expect(await rows(`SELECT workspace_id, site_id FROM chatcops_conversations WHERE id = 'c1'`)).toEqual([{ workspace_id: workspace, site_id: 'site-1' }]);
    expect(await rows(`SELECT workspace_id, site_id FROM chatcops_messages WHERE conversation_id = 'c1'`)).toEqual([{ workspace_id: workspace, site_id: 'site-1' }]);
    expect(hook).toHaveBeenCalledWith(expect.objectContaining({ table: 'messages', conversationId: 'c1', message: expect.objectContaining({ id: 'u1' }) }));
  });

  it('only stamps on insert: a later append or save leaves the conversation row alone', async () => {
    const { store } = setup();
    await store.append?.('c2', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }], { metadata: { workspaceId: workspace, siteId: 'first' } });
    await store.append?.('c2', [{ id: 'u2', role: 'user', content: 'Again', timestamp: 2 }], { metadata: { siteId: 'second' } });
    expect(await rows(`SELECT site_id FROM chatcops_conversations WHERE id = 'c2'`)).toEqual([{ site_id: 'first' }]);
    expect(await rows(`SELECT site_id FROM chatcops_messages WHERE conversation_id = 'c2' ORDER BY seq`)).toEqual([{ site_id: 'first' }, { site_id: 'second' }]);

    const conversation = await store.get('c2');
    if (!conversation) throw new Error('c2 was not stored');
    await store.save({ ...conversation, metadata: { siteId: 'third' } });
    expect(await rows(`SELECT site_id FROM chatcops_conversations WHERE id = 'c2'`)).toEqual([{ site_id: 'first' }]);
  });

  it('binds values as parameters, never as SQL, and stores booleans as 1 or 0', async () => {
    const store = cloudflareStorage({
      d1,
      extraColumns: ['site_id', 'trial'],
      rowHook: ({ metadata }) => ({ site_id: metadata?.siteId, trial: true }),
    }).conversations;
    const sneaky = "x'); DROP TABLE chatcops_messages; --";
    await store.save({ id: 'c3', messages: [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }], metadata: { siteId: sneaky }, createdAt: 1, updatedAt: 1 });
    expect(await rows(`SELECT site_id, trial FROM chatcops_messages WHERE conversation_id = 'c3'`)).toEqual([{ site_id: sneaky, trial: 1 }]);
  });

  it('refuses a key that is not declared, and stores nothing from that write', async () => {
    const { store } = setup(() => ({ tenant: 'x' }));
    await expect(store.append?.('c4', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }])).rejects.toThrow(
      'rowHook returned "tenant", which isn\'t in extraColumns'
    );
    expect(await store.get('c4')).toBeNull();
  });

  it('refuses a value D1 cannot store', async () => {
    const { store } = setup(() => ({ site_id: { nested: true } }));
    await expect(store.append?.('c5', [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }])).rejects.toThrow(
      'rowHook returned an unsupported value (object) for "site_id"'
    );
  });
});

describe('extraColumns checks', () => {
  it('needs both options or neither', () => {
    expect(() => cloudflareStorage({ d1, extraColumns: ['a'] })).toThrow('both extraColumns and rowHook');
    expect(() => cloudflareStorage({ d1, rowHook: () => ({}) })).toThrow('both extraColumns and rowHook');
  });

  it("only takes plain column names, and not the store's own columns", () => {
    const rowHook = () => ({});
    expect(() => cloudflareStorage({ d1, extraColumns: ['bad name'], rowHook })).toThrow('plain lowercase column name');
    expect(() => cloudflareStorage({ d1, extraColumns: ['message'], rowHook })).toThrow("store's own columns");
  });
});
