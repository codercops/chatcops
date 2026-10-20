// Static page + mock chat endpoint for the browser tests.
// Serves the built widget, so run `pnpm --filter @chatcops/widget build` first.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const port = Number(process.env.E2E_PORT ?? 4173);

const files = {
  '/': ['fixtures/index.html', 'text/html'],
  '/index.html': ['fixtures/index.html', 'text/html'],
  '/two-widgets.html': ['fixtures/two-widgets.html', 'text/html'],
};

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
async function chat(req, res) {
  const body = await readJson(req);
  const message = String(body.message ?? '');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
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
      return res.end(await readFile(join(here, file[0])));
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});

server.listen(port, () => console.log(`e2e server on http://localhost:${port}`));
