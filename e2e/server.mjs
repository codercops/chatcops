// The page server for the browser tests: the built widget, the fixtures, and
// the real @chatcops/server handler on /api/chat with a provider that answers
// by the message text. A second server on another port is a 0.5-style mock,
// for the cross-origin tests. Build the widget, core and server first.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatHandler } from '../packages/server/dist/index.js';
import { fetchChatResponse } from '../packages/server/dist/http.js';
import { originPolicy } from '../packages/server/dist/security/origin-policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const port = Number(process.env.E2E_PORT ?? 4173);
const apiPort = Number(process.env.E2E_API_PORT ?? 4174);

const files = {
  '/': ['fixtures/index.html', 'text/html'],
  '/index.html': ['fixtures/index.html', 'text/html'],
  '/two-widgets.html': ['fixtures/two-widgets.html', 'text/html'],
  '/cross-origin.html': ['fixtures/cross-origin.html', 'text/html'],
  '/legacy.html': ['fixtures/legacy.html', 'text/html'],
  '/legacy-cross-origin.html': ['fixtures/legacy-cross-origin.html', 'text/html'],
  '/slow-tool.html': ['fixtures/slow-tool.html', 'text/html'],
  '/sessions.html': ['fixtures/sessions.html', 'text/html'],
  '/full.html': ['fixtures/full.html', 'text/html'],
  '/theme.html': ['fixtures/theme.html', 'text/html'],
  '/prechat.html': ['fixtures/prechat.html', 'text/html'],
  '/locale.html': ['fixtures/locale.html', 'text/html'],
  '/locales/zz.js': ['fixtures/locales/zz.js', 'text/javascript'],
};

const apiRequests = [];
const legacyApiRequests = [];

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const REPLY = ['Hello', ' from', ' the', ' test', ' server.'];
/** How long the slow tool takes, well past the slow-tool page's 1.5 s widget timeout. */
const SLOW_TOOL_MS = 4000;

/**
 * A provider that answers by the last user message, so a test picks the
 * scenario:
 * - "fail midway": some text, then the model request fails
 * - "cut off": some text, then nothing (the bridge below ends the response)
 * - "slow tool": calls `slow_lookup`, then answers once it returns
 * - "long reply": about 4,000 words of markdown in small pieces, for the render cost test
 * - "still streaming": some text, then nothing for a minute, with the response open
 * - "with sources": a reply that cites the pricing page, found by the knowledge source below
 * - anything else: a normal streamed reply
 */
/**
 * About 4,000 words of markdown (paragraphs, lists, bold, a code block),
 * split into pieces of four words or so, like a model streams them.
 */
const LONG_REPLY = (() => {
  const vocabulary = 'the plan includes support for teams that need a fast answer about pricing refunds and setup'.split(' ');
  const blocks = [];
  let words = 0;
  for (let n = 0; words < 4000; n++) {
    if (n % 6 === 5) {
      blocks.push(['- **First** item of the list', '- second item, with `code`', '- third item'].join('\n'));
      words += 16;
    } else if (n === 20) {
      blocks.push('```\nnpm install @chatcops/widget\n\nnpx chatcops test\n```');
      words += 6;
    } else {
      const paragraph = Array.from({ length: 60 }, (_, i) => vocabulary[(n * 7 + i) % vocabulary.length]).join(' ');
      blocks.push(`${paragraph.charAt(0).toUpperCase()}${paragraph.slice(1)}.`);
      words += 60;
    }
  }
  const pieces = blocks.join('\n\n').match(/(?:\S+\s*){1,4}|\s+/g);
  return pieces;
})();

const provider = {
  name: 'e2e',
  model: 'e2e',
  async *step({ messages, signal }) {
    const last = messages.at(-1);
    const askedText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const text = async function* (words) {
      for (const delta of words) {
        await sleep(40, signal);
        yield { type: 'text-delta', delta };
      }
    };

    if (/slow tool/i.test(askedText) && !(last?.parts ?? []).some((p) => p.type === 'tool-result')) {
      const call = { id: 'call_slow', name: 'slow_lookup', input: {} };
      yield { type: 'tool-call', call };
      yield {
        type: 'finish',
        reason: 'tool-calls',
        usage: { inputTokens: 1, outputTokens: 1 },
        parts: [{ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: {}, executor: 'server', state: 'pending' }],
      };
      return;
    }

    if (/long reply/i.test(askedText)) {
      for (const delta of LONG_REPLY) {
        await sleep(1, signal);
        yield { type: 'text-delta', delta };
      }
      yield { type: 'finish', reason: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, parts: [{ type: 'text', text: LONG_REPLY.join('') }] };
      return;
    }

    const words = /slow tool/i.test(askedText)
      ? ['Found', ' it.']
      : /with sources/i.test(askedText)
        ? ['Plans start', ' at $19', ' a month [1].']
        : /fail midway|cut off|still streaming/i.test(askedText)
          ? REPLY.slice(0, 3)
          : REPLY;
    yield* text(words);
    if (/fail midway/i.test(askedText)) throw new Error('The e2e provider failed on purpose.');
    if (/cut off|still streaming/i.test(askedText)) await sleep(60_000, signal);
    yield {
      type: 'finish',
      reason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
      parts: [{ type: 'text', text: words.join('') }],
    };
  },
};

const slowLookup = {
  name: 'slow_lookup',
  description: 'Takes a while.',
  inputSchema: { type: 'object', properties: {} },
  async execute() {
    await sleep(SLOW_TOOL_MS);
    return { success: true, data: { found: true } };
  },
};

/** Finds the pricing page for "with sources", and nothing otherwise. */
const pricingPage = {
  type: 'e2e',
  async getContext() {
    return '';
  },
  async retrieve({ text }) {
    if (!/with sources/i.test(text)) return [];
    return [{
      id: 'pricing#0',
      text: 'Plans start at $19 a month.',
      score: 1,
      source: { id: 'pricing', url: 'https://example.com/pricing', title: 'Pricing' },
    }];
  },
};

function chatEndpoint(overrides = {}) {
  const config = {
    provider,
    systemPrompt: 'e2e',
    knowledge: [pricingPage],
    tools: [slowLookup],
    toolTimeoutMs: 30_000,
    budgets: false,
    allowAnonymous: true,
    ...overrides,
  };
  const handler = createChatHandler(config);
  const origins = originPolicy(config);
  return (request) => fetchChatResponse(handler, origins, request, { clientIp: () => undefined, pingIntervalMs: 300 });
}

const endpoints = {
  '/api/chat': chatEndpoint(),
  // Session tokens on, for the session spec.
  '/api/secure-chat': chatEndpoint({ sessionSecrets: ['an-e2e-session-secret-of-32-bytes-or-more'], allowAnonymous: false }),
};

/** Runs a Fetch API handler for a Node request. */
async function serveFetch(handle, req, res) {
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
  const response = await handle(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers, body }));

  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) return res.end();

  // "cut off": end the response after the third piece of text, without
  // finish or [DONE], the way a proxy timeout or a crash would.
  let cutAfter = 0;
  try {
    cutAfter = /cut off/i.test(JSON.parse(body?.toString() ?? '{}').message) ? 3 : 0;
  } catch {
    // Not JSON; the handler already answered 400.
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let texts = 0;
  res.on('close', () => reader.cancel().catch(() => {}));
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
    texts += decoder.decode(value).split('"type":"text-delta"').length - 1;
    if (cutAfter && texts >= cutAfter) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  res.end();
}

/** The 0.5-style mock for the cross-origin tests: CORS for Content-Type only, and the old stream format. */
async function legacyChat(req, res, requestLog) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw.toString());
  } catch {
    body = {};
  }
  requestLog.push({ method: 'POST', body });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  for (const word of ['Hello', ' from', ' the', ' mock', ' server.']) {
    res.write(`data: ${JSON.stringify({ content: word })}\n\n`);
    await sleep(40);
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end('data: [DONE]\n\n');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  try {
    const endpoint = Object.entries(endpoints).find(([path]) => url.pathname === path || url.pathname === `${path}/session`);
    if (endpoint) return await serveFetch(endpoint[1], req, res);

    // The widget builds: chatcops.min.js (loader), chatcops.panel.js and the chunks it loads,
    // chatcops.full.min.js, chatcops.esm.js.
    const widgetFile = /^\/(chatcops\.(?:min|panel|full\.min|esm)\.js|chunks\/[\w-]+\.js)$/.exec(url.pathname)?.[1];
    if (widgetFile) {
      const js = await readFile(join(root, 'packages/widget/dist', widgetFile));
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(js);
    }

    if (url.pathname === '/legacy/chatcops.min.js') {
      const js = await readFile(join(root, 'node_modules/chatcops-widget-0-5/dist/chatcops.min.js'));
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(js);
    }

    const file = files[url.pathname];
    if (file) {
      res.writeHead(200, { 'Content-Type': file[1] });
      let content = await readFile(join(here, file[0]), 'utf8');
      content = content.replaceAll('__E2E_API_PORT__', String(apiPort));
      return res.end(content);
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});

const apiServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${apiPort}`);
  try {
    if (url.pathname === '/__test__/api-requests' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(url.searchParams.has('legacy') ? legacyApiRequests : apiRequests));
    }

    const chatPath = url.pathname === '/api/chat' || url.pathname === '/legacy/api/chat';
    // Isolate legacy traffic so parallel tests don't pollute the existing spec's log.
    const requestLog = url.pathname === '/legacy/api/chat' ? legacyApiRequests : apiRequests;
    if (chatPath && req.method === 'OPTIONS') {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      requestLog.push({ method: 'OPTIONS', status: 204, headers });
      res.writeHead(204, headers);
      return res.end();
    }

    if (chatPath && req.method === 'POST') {
      return await legacyChat(req, res, requestLog);
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});

server.on('error', (error) => console.error('e2e page server error:', error));
apiServer.on('error', (error) => console.error('e2e API server error:', error));

const serverMode = process.argv[2] ?? 'both';
if (serverMode === 'page' || serverMode === 'both') {
  server.listen(port, () => console.log(`e2e page server on http://localhost:${port}`));
}
if (serverMode === 'api' || serverMode === 'both') {
  apiServer.listen(apiPort, () => console.log(`e2e API server on http://localhost:${apiPort}`));
}

function shutdown() {
  if (server.listening) server.close();
  if (apiServer.listening) apiServer.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
