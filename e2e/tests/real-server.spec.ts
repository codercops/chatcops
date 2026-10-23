import { expect, test } from '@playwright/test';

// These run against the real @chatcops/server handler (see e2e/server.mjs).
const fab = '.cc-fab';
const input = '.cc-input';
const send = '.cc-send-btn';

test('the widget speaks protocol v1 with the real server', async ({ page }) => {
  await page.goto('/');
  const response = page.waitForResponse((res) => res.url().endsWith('/api/chat') && res.request().method() === 'POST');
  await page.locator(fab).click();
  await page.locator(input).fill('Hi there');
  await page.locator(send).click();

  const reply = await response;
  expect(reply.headers()['x-chatcops-protocol']).toBe('1');
  expect(reply.request().postDataJSON()).toMatchObject({ protocol: 1, message: 'Hi there' });
  await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');
});

test('pings keep a reply alive through a tool that runs longer than the widget timeout', async ({ page }) => {
  test.slow();
  await page.goto('/slow-tool.html');
  await page.locator(fab).click();
  await page.locator(input).fill('Please run the slow tool');
  await page.locator(send).click();

  const reply = page.locator('.cc-message-assistant').last();
  await expect(reply).toContainText('Found it.', { timeout: 15_000 });
  await expect(reply.locator('.cc-message-error-note')).toHaveCount(0);
});

test('with session tokens on, the widget gets a token and sends it', async ({ page }) => {
  await page.goto('/sessions.html');
  const requests: Array<{ url: string; status: number; auth?: string }> = [];
  page.on('response', (res) => {
    if (res.url().includes('/api/secure-chat')) {
      requests.push({ url: new URL(res.url()).pathname, status: res.status(), auth: res.request().headers().authorization });
    }
  });

  await page.locator(fab).click();
  await page.locator(input).fill('Hi there');
  await page.locator(send).click();
  await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');

  await page.locator(input).fill('Again');
  await page.locator(send).click();
  await expect(page.locator('.cc-message-assistant', { hasText: 'Hello from the test server.' })).toHaveCount(2);

  expect(requests.map(({ url, status }) => `${status} ${url}`)).toEqual([
    '401 /api/secure-chat',
    '200 /api/secure-chat/session',
    '200 /api/secure-chat',
    '200 /api/secure-chat',
  ]);
  expect(requests[2].auth).toMatch(/^Bearer /);
  expect(requests[3].auth).toBe(requests[2].auth);
});
