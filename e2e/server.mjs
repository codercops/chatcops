// Static page + mock chat endpoint for the browser tests.
// Serves the built widget, so run `pnpm --filter @chatcops/widget build` first.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const port = Number(process.env.E2E_PORT ?? 4173);
const apiPort = Number(process.env.E2E_API_PORT ?? 4174);

const files = {
  '/': ['fixtures/index.html', 'text/html'],
  '/index.html': ['fixtures/index.html', 'text/html'],
  '/two-widgets.html': ['fixtures/two-widgets.html', 'text/html'],
  '/cross-origin.html': ['fixtures/cross-origin.html', 'text/html'],
};

const apiRequests = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

/**
 * The reply depends on the message text, so a test picks the scenario:
 * - "fail midway": some text, then an error chunk
 * - "cut off": some text, then the connection ends without [DONE]
 * - anything else: a normal streamed reply
 */
async function chat(req, res, cors = false) {
  const body = await readJson(req);
  const message = String(body.message ?? '');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}),
  });

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const words = ['Hello', ' from', ' the', ' mock', ' server.'];

  if (/fail midway/i.test(message)) {
    for (const word of words.slice(0, 3)) {
      send({ content: word });
      await sleep(40);
    }
    send({ error: 'provider_error' });
    res.end('data: [DONE]\n\n');
    return;
  }

  if (/cut off/i.test(message)) {
    for (const word of words.slice(0, 3)) {
      send({ content: word });
      await sleep(40);
    }
    res.end();
    return;
  }

  for (const word of words) {
    send({ content: word });
    await sleep(40);
  }
  send({ done: true });
  res.end('data: [DONE]\n\n');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  try {
    if (url.pathname === '/api/chat' && req.method === 'POST') return await chat(req, res);

    if (url.pathname === '/chatcops.esm.js') {
      const js = await readFile(join(root, 'packages/widget/dist/chatcops.esm.js'));
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(js);
    }

    if (url.pathname === '/chatcops.min.js') {
      const js = await readFile(join(root, 'packages/widget/dist/chatcops.min.js'));
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
      return res.end(JSON.stringify(apiRequests));
    }

    if (url.pathname === '/api/chat' && req.method === 'OPTIONS') {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      apiRequests.push({ method: 'OPTIONS', status: 204, headers });
      res.writeHead(204, headers);
      return res.end();
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      apiRequests.push({ method: 'POST' });
      return await chat(req, res, true);
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
