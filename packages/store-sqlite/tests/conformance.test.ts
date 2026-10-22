import { runStorageConformance } from '@chatcops/core/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqliteStorage } from '../src/index.js';
import { afterAll } from 'vitest';

runStorageConformance('sqlite (:memory:)', () => sqliteStorage({ path: ':memory:' }));

const directory = mkdtempSync(join(tmpdir(), 'chatcops-sqlite-conformance-'));
runStorageConformance('sqlite (file)', () => sqliteStorage({ path: join(directory, 'chatcops.db') }));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
