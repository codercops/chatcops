import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { sqliteStorage } from '../src/index.js';

describe('sqlite persistence', () => {
  it('does not close a database supplied by the caller', async () => {
    const database = new DatabaseSync(':memory:');
    const storage = sqliteStorage({ database });
    await storage.close?.();
    expect(() => database.exec('SELECT 1')).not.toThrow();
    database.close();
  });

  it('persists a file database across close and reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'chatcops-sqlite-'));
    const path = join(directory, 'chatcops.db');
    try {
      const first = sqliteStorage({ path });
      await first.conversations.append?.('persisted', [{ id: 'm1', role: 'user', content: 'hello', timestamp: 1 }]);
      await first.close?.();
      const second = sqliteStorage({ path });
      expect((await second.conversations.get('persisted'))?.messages[0].content).toBe('hello');
      await second.close?.();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
