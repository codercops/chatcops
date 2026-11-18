import { runStorageConformance } from '@chatcops/core/testing';
import { afterAll } from 'vitest';
import { cloudflareStorage } from '../src/index.js';
import { disposeMiniflare, getMiniflareBindings } from './miniflare.js';

runStorageConformance(
  'cloudflare (D1 + DO)',
  async () => {
    const { d1, counters, vectorize } = await getMiniflareBindings();
    return cloudflareStorage({ d1, counters, vectorize, vectorDimensions: 4 });
  }
);

runStorageConformance(
  'cloudflare (D1 only)',
  async () => {
    const { d1, vectorize } = await getMiniflareBindings();
    return cloudflareStorage({ d1, vectorize, vectorDimensions: 4 });
  }
);

afterAll(async () => {
  await disposeMiniflare();
});
