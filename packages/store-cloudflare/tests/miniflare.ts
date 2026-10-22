import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { ChatCopsCounter, D1Database, DurableObjectNamespace } from '../src/index.js';

let mf: Miniflare | undefined;
let d1Instance: D1Database | undefined;
let countersInstance: DurableObjectNamespace<ChatCopsCounter> | undefined;

export async function getMiniflareBindings() {
  if (!mf) {
    const countersPath = new URL('../dist/counters.js', import.meta.url);
    const countersSource = readFileSync(countersPath, 'utf8');

    mf = new Miniflare({
      name: 'test-worker',
      compatibilityDate: '2026-07-30',
      compatibilityFlags: ['nodejs_compat'],
      modules: [
        {
          type: 'ESModule',
          path: 'index.js',
          contents: `
            export { ChatCopsCounter } from './counters.js';
            export default {
              fetch() { return new Response('ok'); }
            };
          `,
        },
        {
          type: 'ESModule',
          path: 'counters.js',
          contents: countersSource,
        },
      ],
      d1Databases: ['DB'],
      durableObjects: {
        COUNTERS: {
          className: 'ChatCopsCounter',
          useSQLite: true,
        },
      },
      unsafeInspectDurableObjects: true,
    });
    await mf.ready;
    d1Instance = (await mf.getD1Database('DB')) as unknown as D1Database;
    countersInstance = (await mf.getDurableObjectNamespace('COUNTERS')) as unknown as DurableObjectNamespace<ChatCopsCounter>;
  }
  if (!d1Instance || !countersInstance) {
    throw new Error('Failed to initialize Miniflare bindings');
  }
  return { mf, d1: d1Instance, counters: countersInstance };
}

export async function disposeMiniflare() {
  await mf?.dispose();
  mf = undefined;
}
