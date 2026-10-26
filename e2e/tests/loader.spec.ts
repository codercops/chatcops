import { expect, test, type Page } from '@playwright/test';

// The script tag build is a small loader: the chat panel (chatcops.panel.js)
// only downloads when the visitor is about to use it.
const fab = '.cc-fab';
const panelRequests = (urls: string[]) => urls.filter((url) => new URL(url).pathname === '/chatcops.panel.js');

test('the panel downloads on hover, not on page load, and opens on click', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/');
  await expect(page.locator(fab)).toBeVisible();
  await page.waitForTimeout(300);
  expect(panelRequests(requested)).toEqual([]);

  await page.locator(fab).hover();
  await expect.poll(() => panelRequests(requested).length).toBe(1);
  expect(new URL(panelRequests(requested)[0]).searchParams.get('v')).toMatch(/^\d+\.\d+\.\d+/);

  await page.locator(fab).click();
  await expect(page.locator('.cc-panel')).toHaveClass(/cc-visible/);
  await page.locator('.cc-input').fill('Hi there');
  await page.locator('.cc-send-btn').click();
  await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');
  expect(panelRequests(requested)).toHaveLength(1);
});

for (const [build, path] of [['loader', '/'], ['single-file build', '/full.html']] as const) {
  test(`nothing reads or writes storage before the visitor interacts (${build})`, async ({ page }) => {
    await countStorageCalls(page);
    await page.goto(path);
    await expect(page.locator(fab)).toBeVisible();
    await page.locator(fab).hover();
    await page.waitForTimeout(500);
    expect(await storageCalls(page)).toEqual([]);

    await page.locator(fab).click();
    await expect(page.locator('.cc-panel')).toHaveClass(/cc-visible/);
    expect(await storageCalls(page)).toContain('getItem');
  });
}

test('a conversation comes back after a reload, once the chat is opened', async ({ page }) => {
  await page.goto('/');
  await page.locator(fab).click();
  await page.locator('.cc-input').fill('Remember this');
  await page.locator('.cc-send-btn').click();
  await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');

  await page.reload();
  await expect(page.locator(fab)).toBeVisible();
  await page.locator(fab).click();
  await expect(page.locator('.cc-message-user').last()).toContainText('Remember this');
});

async function storageCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { storageCalls: string[] }).storageCalls);
}

async function countStorageCalls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { storageCalls: string[] }).storageCalls = calls;
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (this: Storage, ...args: [string, string]) {
        calls.push(method);
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      } as never;
    }
  });
}

test('a panel that fails to load leaves the launcher, says why, and works on the next try', async ({ page }) => {
  let fail = true;
  await page.route('**/chatcops.panel.js*', (route) => (fail ? route.abort() : route.continue()));
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto('/');

  await page.locator(fab).click();
  await expect(page.locator(fab)).toHaveAttribute('data-state', 'error');
  await expect(page.locator(fab)).toHaveAttribute('aria-label', /Connection error/);
  expect(errors.some((text) => text.includes('[chatcops] The chat could not load'))).toBe(true);

  fail = false;
  await page.locator(fab).click();
  await expect(page.locator('.cc-panel')).toHaveClass(/cc-visible/);
});

test('the single-file build (chatcops.full.min.js) still works on its own', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  await page.goto('/full.html');
  await page.locator(fab).click();
  await page.locator('.cc-input').fill('Hi there');
  await page.locator('.cc-send-btn').click();
  await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');
  expect(requested).not.toContain('/chatcops.panel.js');
  expect(requested).not.toContain('/chatcops.min.js');
});
