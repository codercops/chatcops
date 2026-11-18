import { createHmac } from 'node:crypto';
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

const IDENTITY_SECRET = 'an-e2e-identity-secret-of-32-bytes-or-more';
const signedToken = (userId: string, lifetimeSeconds: number) => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, exp: Math.floor(Date.now() / 1000) + lifetimeSeconds })}`;
  return `${body}.${createHmac('sha256', IDENTITY_SECRET).update(body).digest('base64url')}`;
};

test('a userToken function gives the server a fresh token when the session is requested', async ({ page }) => {
  // A token is signed when the session is requested, not when the page loads, so it cannot have expired by then.
  let calls = 0;
  await page.exposeFunction('signToken', () => {
    calls++;
    return signedToken('visitor-1', 300);
  });
  await page.goto('/sessions.html');
  await page.evaluate(() => {
    const w = window as unknown as { signToken(): Promise<string>; ChatCops: { init(config: object): void } };
    w.ChatCops.init({ apiUrl: '/api/identity-chat', userToken: () => w.signToken() });
  });
  const sessions: Array<{ status: number }> = [];
  page.on('response', (res) => {
    if (res.url().endsWith('/api/identity-chat/session')) sessions.push({ status: res.status() });
  });

  await page.locator(fab).click();
  expect(calls).toBe(0);
  await page.locator(input).fill('Hi there');
  await page.locator(send).click();
  await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');
  await page.locator(input).fill('Again');
  await page.locator(send).click();
  await expect(page.locator('.cc-message-assistant', { hasText: 'Hello from the test server.' })).toHaveCount(2);

  expect(sessions).toEqual([{ status: 200 }]);
  expect(calls).toBe(1);
});

test('with a userToken that is not a valid token, the server refuses the session', async ({ page }) => {
  await page.goto('/sessions.html');
  await page.evaluate(() => {
    (window as unknown as { ChatCops: { init(config: object): void } }).ChatCops.init({
      apiUrl: '/api/identity-chat',
      userToken: () => 'not.a.token',
    });
  });
  await page.locator(fab).click();
  await page.locator(input).fill('Hi there');
  await page.locator(send).click();
  await expect(page.locator('.cc-message-assistant').last()).toContainText('Something went wrong');
});
