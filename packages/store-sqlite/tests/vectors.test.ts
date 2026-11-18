import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { sqliteStorage } from '../src/index.js';

describe('SQLite vector lifecycle', () => {
  it('does not load an extension unless vectors are enabled', async () => {
    const database = new DatabaseSync(':memory:');
    const load = vi.spyOn(database, 'loadExtension');
    const storage = sqliteStorage({ database });
    expect(storage.vectors).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    await storage.conversations.save({ id: 'plain', messages: [], createdAt: 1, updatedAt: 1 });
    expect(await storage.conversations.get('plain')).not.toBeNull();
    database.close();
  });

  it('persists vectors and rejects a different dimension on reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'chatcops-vectors-'));
    const path = join(directory, 'vectors.db');
    try {
      const first = sqliteStorage({ path, vectors: { dimensions: 4 } });
      await first.vectors?.upsert([{ id: 'one', vector: new Float32Array([1, 0, 0, 0]), text: 'persistent record', source: { id: 'page', url: '/page' } }]);
      await first.close?.();
      const second = sqliteStorage({ path, vectors: { dimensions: 4 } });
      expect((await second.vectors?.query({ vector: new Float32Array([1, 0, 0, 0]), topK: 1 }))?.[0].id).toBe('one');
      await second.close?.();
      const database = new DatabaseSync(path, { allowExtension: true });
      try {
        expect(() => sqliteStorage({ database, vectors: { dimensions: 5 } })).toThrow(/dimensions/);
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
