import { runStorageConformance } from '@chatcops/core/testing';
import { afterAll } from 'vitest';
import { cloudflareStorage } from '../src/index.js';
import { disposeMiniflare, getMiniflareBindings } from './miniflare.js';

runStorageConformance(
  'cloudflare (D1 + DO)',
  async () => {
    const { d1, counters } = await getMiniflareBindings();
    return cloudflareStorage({ d1, counters });
  }
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
