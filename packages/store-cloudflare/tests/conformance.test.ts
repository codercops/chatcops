import { runStorageConformance } from '@chatcops/core/testing';
import { afterAll } from 'vitest';
import { cloudflareStorage } from '../src/index.js';
import { disposeMiniflare, getMiniflareBindings } from './miniflare.js';

runStorageConformance(
  'cloudflare (D1 + KV + DO)',
  async () => {
    const { d1, kv, counters } = await getMiniflareBindings();
    return cloudflareStorage({ d1, kv, counters });
  },
  { skip: ['kv-ttl'] }
);

runStorageConformance(
  'cloudflare (D1 only)',
  async () => {
    const { d1 } = await getMiniflareBindings();
    return cloudflareStorage({ d1 });
  }
);

afterAll(async () => {
  await disposeMiniflare();
});
