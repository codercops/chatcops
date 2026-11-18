import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const legacyPath = '/legacy/chatcops.min.js';
const crossOriginApi = `http://localhost:${process.env.E2E_API_PORT ?? 4174}/legacy/api/chat`;

for (const [fixture, expectedReply] of [
  ['legacy.html', 'Hello from the test server.'],
  ['legacy-cross-origin.html', 'Hello from the mock server.'],
]) {
  test(`published 0.5.0 widget streams a reply on ${fixture}`, async ({ page, request }) => {
    const requestedPaths: string[] = [];
    page.on('request', (request) => requestedPaths.push(new URL(request.url()).pathname));
    const bundleResponse = page.waitForResponse((response) => new URL(response.url()).pathname === legacyPath);

    await page.goto(`/${fixture}`);
    const bundle = await bundleResponse;
    expect(bundle.status()).toBe(200);
    expect(bundle.request().resourceType()).toBe('script');
    // Check the browser's bytes against the pinned published artifact, not just its URL.
    const published = await readFile('node_modules/chatcops-widget-0-5/dist/chatcops.min.js');
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    expect(digest(await bundle.body()), 'must load the published 0.5.0 bundle').toBe(digest(published));

    await page.locator('.cc-fab').click();
    await expect(page.locator('.cc-panel')).toHaveClass(/cc-visible/);
    await page.locator('.cc-input').fill('Hello from the published widget');
    const apiUrl = fixture === 'legacy-cross-origin.html' ? crossOriginApi : new URL('/api/chat', page.url()).href;
    const replyResponse = page.waitForResponse(
      (response) => response.url() === apiUrl && response.request().method() === 'POST',
    );
    await page.locator('.cc-send-btn').click();

    const reply = await replyResponse;
    expect(reply.status()).toBe(200);
    const sent = reply.request().postDataJSON();
    expect(sent).not.toHaveProperty('protocol');
    expect(reply.headers()['content-type']).toContain('text/event-stream');
    if (fixture === 'legacy-cross-origin.html') expect(reply.headers()['access-control-allow-origin']).toBe('*');
    await expect(page.locator('.cc-message-user').last()).toContainText('Hello from the published widget');
    await expect(page.locator('.cc-message-assistant').last()).toContainText(expectedReply);
    if (fixture === 'legacy-cross-origin.html') {
      const log = await request.get(new URL('/__test__/api-requests?legacy=1', apiUrl).href);
      expect(log.ok()).toBe(true);
      const requests = (await log.json()) as Array<{ method: string; body?: { conversationId?: string; protocol?: number } }>;
      const logged = requests.find(({ method, body }) => method === 'POST' && body?.conversationId === sent.conversationId);
      if (!logged?.body) throw new Error('Published widget request missing from the API log');
      expect(logged.body).not.toHaveProperty('protocol');
    }
    expect(requestedPaths.filter((path) => path === legacyPath)).toHaveLength(1);
    expect(requestedPaths).not.toContain('/chatcops.min.js');
  });
}
