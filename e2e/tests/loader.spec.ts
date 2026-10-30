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

test('the script nonce allows launcher, panel and lazy pre-chat styles under CSP', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { cspViolations: string[] }).cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { cspViolations: string[] }).cspViolations.push(event.violatedDirective);
    });
  });
  await page.goto('/csp.html');
  await expect(page.locator(fab)).toBeVisible();
  expect(await page.locator('#chatcops-root').evaluate((host) => host.shadowRoot?.querySelector('style')?.nonce)).toBe('chatcops-e2e');

  await page.evaluate(() => {
    (window as unknown as { ChatCops: { init(config: object): void } }).ChatCops.init({
      apiUrl: '/api/chat',
      nonce: 'chatcops-e2e',
      preChatForm: { enabled: true, fields: [{ name: 'name', label: 'Name', type: 'text' }] },
    });
  });
  await page.locator(fab).click();
  await expect(page.locator('.cc-prechat')).toBeVisible();
  const nonces = await page.locator('#chatcops-root').evaluate((host) =>
    Array.from(host.shadowRoot?.querySelectorAll('style') ?? [], (style) => style.nonce)
  );
  expect(nonces).toEqual(['chatcops-e2e', 'chatcops-e2e']);
  expect(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)).toEqual([]);
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

const chunkRequests = (urls: string[]) => urls.filter((url) => new URL(url).pathname.startsWith('/chunks/'));

test('the pre-chat form downloads only on pages that use it, and works', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));

  await page.goto('/');
  await page.locator(fab).click();
  await expect(page.locator('.cc-panel')).toHaveClass(/cc-visible/);
  expect(chunkRequests(requested)).toEqual([]);

  requested.length = 0;
  await page.goto('/prechat.html');
  await page.locator(fab).hover();
  await expect.poll(() => chunkRequests(requested).some((url) => url.includes('/chunks/prechat-form-'))).toBe(true);
  await page.locator(fab).click();
  await page.locator('.cc-prechat-input').fill('Sam');
  await page.locator('.cc-prechat-submit').click();
  await expect(page.locator('.cc-message-assistant').first()).toContainText('Hi Sam!');
  await page.locator('.cc-input').fill('Hi there');
  await page.locator('.cc-send-btn').click();
  await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');
});

test('the chat loads its translation next to the panel, and falls back to English without one', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  await page.goto('/locale.html');
  await page.waitForTimeout(300);
  expect(requested).not.toContain('/locales/zz.js');

  await page.locator(fab).click();
  await expect(page.locator('.cc-message-assistant').first()).toContainText('Zz welcome from the translation file');
  await expect(page.locator('.cc-input')).toHaveAttribute('placeholder', 'Zz type here');

  // A language with no file: one failed request, then English.
  const warnings: string[] = [];
  page.on('console', (message) => message.type() === 'warning' && warnings.push(message.text()));
  await page.goto('/locale.html');
  await page.evaluate(() => {
    (window as unknown as { ChatCops: { init(config: object): void } }).ChatCops.init({ apiUrl: '/api/chat', locale: 'qq' });
  });
  await page.locator(fab).click();
  await expect(page.locator('.cc-message-assistant').first()).toContainText('How can I help you today?');
  expect(warnings.some((text) => text.includes('"qq" strings could not load'))).toBe(true);
});

test('a page can drive the chat through window.ChatCops before it has loaded', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(fab)).toBeVisible();
  type Api = {
    sendMessage(text: string): Promise<void>;
    toggle(): void;
    newConversation(): void;
    update(changes: object): void;
    version: string;
  };
  const version = await page.evaluate(() => (window as unknown as { ChatCops: Api }).ChatCops.version);
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
  // Kept until the chat loads, and drawn when it does.
  await page.evaluate(() => (window as unknown as { ChatCops: Api }).ChatCops.update({ branding: { name: 'Sales desk' } }));

  await page.evaluate(() => (window as unknown as { ChatCops: Api }).ChatCops.sendMessage('Hi from the page'));
  await expect(page.locator('.cc-panel')).toHaveClass(/cc-visible/);
  await expect(page.locator('.cc-message-user').last()).toContainText('Hi from the page');
  await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');

  await expect(page.locator('.cc-header-name')).toHaveText('Sales desk');

  await page.evaluate(() => (window as unknown as { ChatCops: Api }).ChatCops.newConversation());
  await expect(page.locator('.cc-message-user')).toHaveCount(0);

  await page.evaluate(() => (window as unknown as { ChatCops: Api }).ChatCops.toggle());
  await expect(page.locator('.cc-panel')).not.toHaveClass(/cc-visible/);
});
