// Records real provider responses for the replay tests in tests/fixtures.
//
//   pnpm --filter @chatcops/core build
//   cd packages/core && node --env-file=../../.env scripts/record-fixtures.mjs claude
//
// Only request and response bodies are written, never headers, and the script
// stops if a body contains an API key. Recording costs a few cents per run.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeProvider } from '../dist/index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const SECRETS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']
  .map((name) => process.env[name])
  .filter((value) => value && value.length > 8);

function recorder(provider, name) {
  const dir = join(FIXTURES, provider, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let count = 0;

  return async (input, init) => {
    const response = await fetch(input, init);
    const text = await response.text();
    const body = typeof init?.body === 'string' ? init.body : '{}';
    for (const secret of SECRETS) {
      if (text.includes(secret) || body.includes(secret)) throw new Error(`A key showed up in ${provider}/${name}; nothing was written.`);
    }
    if (!response.ok) throw new Error(`${provider}/${name}: HTTP ${response.status}`);

    count += 1;
    const id = String(count).padStart(2, '0');
    writeFileSync(join(dir, `${id}.request.json`), `${JSON.stringify(JSON.parse(body), null, 2)}\n`);
    writeFileSync(join(dir, `${id}.response.sse`), text);
    return new Response(text, { status: response.status, headers: { 'content-type': 'text/event-stream' } });
  };
}

async function runStep(provider, params) {
  let finish;
  for await (const event of provider.step(params)) {
    if (event.type === 'finish') finish = event;
  }
  return finish;
}

const user = (content) => ({ id: 'u1', role: 'user', content, timestamp: 0 });

/** The assistant message so far, with a result for every call, as runTurn stores it. */
function withResults(parts, results) {
  const calls = parts.filter((part) => part.type === 'tool-call');
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    timestamp: 0,
    parts: [
      ...parts,
      ...calls.map((call) => ({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { success: true, data: results(call) },
      })),
    ],
  };
}

const SYSTEM = 'You are the support assistant for a small online shop. Keep answers short.';

const ORDERS_TOOL = {
  name: 'lookup_orders',
  description: 'Look up one or more orders by id. Can include line items and tracking.',
  inputSchema: {
    type: 'object',
    properties: {
      orders: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            include: { type: 'array', items: { type: 'string', enum: ['items', 'tracking'] } },
          },
          required: ['id'],
        },
      },
    },
    required: ['orders'],
  },
};

const WEATHER_TOOL = {
  name: 'get_weather',
  description: 'Current weather for one city.',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
};

/** Cases every provider records. `make` builds the provider with the recording fetch. */
async function recordCases(providerName, make) {
  await runStep(make('text'), { messages: [user('Say hello in five words.')], systemPrompt: SYSTEM });

  {
    const provider = make('one-tool');
    const messages = [user('Where is order A-1001? Include tracking. Use the tool.')];
    const first = await runStep(provider, { messages, systemPrompt: SYSTEM, tools: [ORDERS_TOOL] });
    if (first.reason !== 'tool-calls') throw new Error(`${providerName}/one-tool: expected a tool call, got ${first.reason}`);
    const results = () => ({ id: 'A-1001', status: 'shipped', tracking: 'ZX123' });
    await runStep(provider, { messages: [...messages, withResults(first.parts, results)], systemPrompt: SYSTEM, tools: [ORDERS_TOOL] });
  }

  {
    const provider = make('parallel-tools');
    const messages = [user('What is the weather in Paris and in Tokyo right now? Call the tool for both cities at once.')];
    const first = await runStep(provider, { messages, systemPrompt: SYSTEM, tools: [WEATHER_TOOL] });
    const calls = first.parts.filter((part) => part.type === 'tool-call');
    if (calls.length < 2) throw new Error(`${providerName}/parallel-tools: expected two calls in one step, got ${calls.length}`);
    const results = (call) => ({ city: call.input.city, tempC: call.input.city === 'Paris' ? 14 : 19 });
    await runStep(provider, { messages: [...messages, withResults(first.parts, results)], systemPrompt: SYSTEM, tools: [WEATHER_TOOL] });
  }

  {
    const finish = await runStep(make('max-tokens'), {
      messages: [user('Write a long poem about the sea.')],
      systemPrompt: SYSTEM,
      maxTokens: 16,
    });
    if (finish.reason !== 'length') throw new Error(`${providerName}/max-tokens: expected length, got ${finish.reason}`);
  }
}

/** A tool step that comes with thinking, so the signature has to go back on the next request. */
async function recordThinkingTool(providerName, provider) {
  const messages = [user('Orders A-1001 and B-2002 were placed the same day. Look both up, then work out which one reaches me first and why.')];
  const first = await runStep(provider, { messages, systemPrompt: SYSTEM, tools: [ORDERS_TOOL] });
  if (!first.parts.some((part) => part.type === 'reasoning')) throw new Error(`${providerName}/thinking-tool: no reasoning in the first step`);
  if (first.reason !== 'tool-calls') throw new Error(`${providerName}/thinking-tool: expected a tool call, got ${first.reason}`);
  const results = (call) => ({ orders: call.input.orders.map((order) => ({ id: order.id, status: order.id === 'A-1001' ? 'shipped, arrives Friday' : 'packing, arrives Monday' })) });
  await runStep(provider, { messages: [...messages, withResults(first.parts, results)], systemPrompt: SYSTEM, tools: [ORDERS_TOOL] });
}

const claude = (name, extra = {}) =>
  new ClaudeProvider({ type: 'claude', apiKey: process.env.ANTHROPIC_API_KEY, fetch: recorder('claude', name), ...extra });

const providers = {
  claude: async () => {
    await recordCases('claude', (name) => claude(name));
    await recordThinkingTool('claude', claude('thinking-tool', { effort: 'high' }));
  },
};

const which = process.argv.slice(2);
for (const name of which.length ? which : Object.keys(providers)) {
  if (!providers[name]) throw new Error(`Unknown provider ${name}`);
  await providers[name]();
  console.log(`${name}: recorded`);
}
