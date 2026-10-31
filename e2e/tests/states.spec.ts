import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Every widget state in F-05's list that exists today, each checked with axe
// against WCAG 2.2 AA in light, dark and right-to-left. States still to come:
// S8 tool confirmation (F-08), S12 handoff (F-10).

const fab = '.cc-fab';
const panel = '.cc-panel';
const input = '.cc-input';
const send = '.cc-send-btn';

const looks = [
  { name: 'light', config: { theme: { mode: 'light' } } },
  { name: 'dark', config: { theme: { mode: 'dark' } } },
  { name: 'rtl', config: { theme: { mode: 'light' }, dir: 'rtl' } },
] as const;

type Look = (typeof looks)[number];
type Api = {
  destroy(): void;
  init(config: object): void;
  sendMessage(text: string, options?: { open?: boolean }): Promise<void>;
};

/** The single-file build, set up again with this look and `extra`. */
async function start(page: Page, look: Look, extra: object = {}) {
  await page.emulateMedia({ colorScheme: look.config.theme.mode, reducedMotion: 'reduce' });
  await page.goto('/full.html');
  await page.evaluate((config) => {
    const chat = (window as unknown as { ChatCops: Api }).ChatCops;
    chat.destroy();
    chat.init(config);
  }, { apiUrl: '/api/chat', ...look.config, ...extra });
}

async function openChat(page: Page) {
  await page.locator(fab).click();
  await expect(page.locator(panel)).toHaveClass(/cc-visible/);
}

async function ask(page: Page, text: string) {
  await page.locator(input).fill(text);
  await page.locator(send).click();
}

/**
 * Every WCAG 2.2 A and AA rule axe has, at any impact. It waits for the
 * widget's animations first: axe skips the contrast of text that is still
 * fading in, so a check mid-animation passes whatever the colors.
 */
async function expectAccessible(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      [...document.querySelectorAll('.chatcops-root')].flatMap((host) =>
        (host.shadowRoot?.getAnimations() ?? []).map((animation) => animation.finished.catch(() => undefined))
      )
    )
  );
  const results = await new AxeBuilder({ page })
    .include('.chatcops-root')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const found = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' > ')).join(', ')}`
  );
  expect(found).toEqual([]);
}

/** A protocol v1 error answer for the next chat request. */
async function failNextRequest(page: Page, status: number, error: object) {
  await page.route('**/api/chat', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) })
      : route.fallback()
  );
}

for (const look of looks) {
  test.describe(`states, ${look.name}`, () => {
    test('S1 launcher', async ({ page }) => {
      await start(page, look);
      await expect(page.locator(fab)).toBeVisible();
      if (look.name === 'rtl') await expect(page.locator('.chatcops-root')).toHaveAttribute('dir', 'rtl');
      await expectAccessible(page);
    });

    test('S2 launcher with an unread reply', async ({ page }) => {
      await start(page, look);
      await page.evaluate(() => (window as unknown as { ChatCops: Api }).ChatCops.sendMessage('Hi', { open: false }));
      await expect(page.locator('.cc-fab-badge')).toHaveClass(/cc-visible/);
      await expect(page.locator(fab)).toHaveAttribute('aria-label', /1/);
      await expectAccessible(page);
    });

    test('S3 welcome bubble', async ({ page }) => {
      await start(page, look, { welcomeBubble: { text: 'Need help choosing a plan?', delay: 0 } });
      await expect(page.locator('.cc-bubble')).toHaveClass(/cc-visible/);
      await expectAccessible(page);
    });

    test('S4 empty panel with suggestions', async ({ page }) => {
      await start(page, look, { suggestions: ['Pricing', 'Talk to sales'] });
      await openChat(page);
      await expect(page.locator('.cc-suggestion')).toHaveCount(2);
      await expect(page.locator('.cc-disclosure')).toBeVisible();
      await expectAccessible(page);
    });

    test('S5 pre-chat form', async ({ page }) => {
      await start(page, look, {
        preChatForm: {
          enabled: true,
          fields: [
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'topic', label: 'Topic', type: 'select', options: ['Sales', 'Support'] },
            { name: 'message', label: 'Message', type: 'textarea' },
          ],
        },
      });
      await openChat(page);
      await expect(page.locator('.cc-prechat')).toBeVisible();
      await expectAccessible(page);
      // A wrong email: the error shows next to the field, and is still accessible.
      await page.getByRole('textbox', { name: 'Name' }).fill('Sam');
      await page.getByRole('textbox', { name: 'Email' }).fill('not an email');
      await page.locator('.cc-prechat button[type="submit"]').click();
      await expect(page.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#cc-prechat-email-error')).not.toBeEmpty();
      await expectAccessible(page);
    });

    test('S6 reply streaming in', async ({ page }) => {
      await start(page, look);
      await openChat(page);
      await ask(page, 'Please keep it still streaming');
      await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the');
      await expectAccessible(page);
    });

    test('S18 a reply the visitor stopped', async ({ page }) => {
      await start(page, look);
      await page.evaluate(() => {
        const w = window as unknown as { __aborts: number };
        const realFetch = window.fetch;
        w.__aborts = 0;
        window.fetch = (input, init) => {
          init?.signal?.addEventListener('abort', () => w.__aborts++);
          return realFetch(input, init);
        };
      });
      await openChat(page);
      await ask(page, 'Please keep it still streaming');
      const reply = page.locator('.cc-message-assistant').last();
      await expect(reply).toContainText('Hello from the');
      await expect(page.locator(send)).toHaveAccessibleName('Stop');
      await expectAccessible(page);

      await page.locator(send).click();
      // The browser's request was aborted, which is what lets the server stop the model.
      await expect.poll(() => page.evaluate(() => (window as unknown as { __aborts: number }).__aborts)).toBe(1);

      await expect(reply).toContainText('Hello from the');
      await expect(page.locator('.cc-message-error-note')).toHaveCount(0);
      await expect(page.locator('.cc-message-regenerate')).toBeVisible();
      await expect(page.locator(send)).toHaveAccessibleName('Send');
      await expect(page.locator(input)).toBeEnabled();
      await expectAccessible(page);
    });

    test('S19 a message waiting for the connection', async ({ page }) => {
      await start(page, look);
      await openChat(page);
      await page.context().setOffline(true);
      await ask(page, 'Are you there?');

      await expect(page.locator('.cc-message-waiting')).toHaveText("Will send when you're back online");
      await expect(page.locator('.cc-reply-announcement')).toHaveText("Will send when you're back online");
      await expect(page.locator(input)).toBeEnabled();
      await expectAccessible(page);

      // Nothing is clicked: the widget sends it when the browser is back online.
      await page.context().setOffline(false);
      await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');
      await expect(page.locator('.cc-message-waiting')).toHaveCount(0);
      await expect(page.locator('.cc-message-error-note')).toHaveCount(0);
      await expectAccessible(page);
    });

    test('S7 reply with sources', async ({ page }) => {
      await start(page, look);
      await openChat(page);
      await ask(page, 'What does it cost, with sources?');
      const sources = page.locator('.cc-message-sources a');
      await expect(sources).toHaveText(['Pricing']);
      await expect(sources).toHaveAttribute('href', 'https://example.com/pricing');
      await expectAccessible(page);
    });

    test('S9 error that can be retried', async ({ page }) => {
      await start(page, look);
      await openChat(page);
      await ask(page, 'Please fail midway');
      await expect(page.locator('.cc-message-retry')).toBeVisible();
      await expectAccessible(page);
    });

    test('S10 rate limited', async ({ page }) => {
      await start(page, look);
      await openChat(page);
      await failNextRequest(page, 429, { code: 'rate_limited', message: 'Too many requests', retryAfterMs: 20_000 });
      await ask(page, 'Hi');
      await expect(page.locator('.cc-message-assistant').last()).toContainText('Please try again in 20 seconds.');
      await expectAccessible(page);
    });

    // A message typed while the browser is offline waits (S19). This is the connection failing on a request
    // that was sent: the network error, with Retry.
    test('S11 connection lost', async ({ page }) => {
      await start(page, look);
      await openChat(page);
      await page.route('**/api/chat', (route) =>
        route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback()
      );
      await ask(page, 'Hi');
      await expect(page.locator('.cc-message-retry')).toBeVisible();
      await expect(page.locator('.cc-message-waiting')).toHaveCount(0);
      await expectAccessible(page);
    });

    test('S13 conversation limit reached', async ({ page }) => {
      await start(page, look);
      await openChat(page);
      await failNextRequest(page, 429, { code: 'budget_exceeded', message: 'Limit reached', scope: 'conversation' });
      await ask(page, 'Hi');
      await expect(page.locator('.cc-message-assistant').last()).toContainText('This chat has reached its limit.');
      await expectAccessible(page);
    });

    test('S17 waiting for consent', async ({ page }) => {
      await start(page, look, { waitForConsent: true });
      // A function can't be passed in from the test, so set the widget up again with one.
      await page.evaluate((config) => {
        const chat = (window as unknown as { ChatCops: Api }).ChatCops;
        chat.destroy();
        chat.init({ ...config, onConsentRequest: () => undefined });
      }, { apiUrl: '/api/chat', waitForConsent: true, ...look.config });
      await openChat(page);
      await expect(page.locator('.cc-consent')).toBeVisible();
      await expect(page.locator('.cc-consent-btn')).toBeVisible();
      await page.locator('.cc-consent-btn').focus();
      await expect(page.locator('.cc-consent-btn')).toBeFocused();
      await expectAccessible(page);
    });

    test('header menu with keyboard navigation and New conversation', async ({ page }) => {
      await start(page, look, { privacyUrl: 'https://example.com/privacy' });
      await openChat(page);
      await ask(page, 'First message');
      await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');
      await expect(page.locator('.cc-message-user')).toHaveCount(1);

      const moreBtn = page.locator('.cc-header-more');
      await moreBtn.focus();
      await expect(moreBtn).toBeFocused();
      await page.keyboard.press('ArrowDown');

      const menu = page.locator('.cc-header-menu');
      await expect(menu).toBeVisible();
      await expect(moreBtn).toHaveAttribute('aria-expanded', 'true');

      await expectAccessible(page);

      await page.keyboard.press('Enter');
      await expect(menu).not.toBeVisible();
      await expect(moreBtn).toHaveAttribute('aria-expanded', 'false');

      await expect(page.locator('.cc-message-user')).toHaveCount(0);
    });

    test.describe('S14 on a phone', () => {
      test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

      test('full screen panel with a reply', async ({ page }) => {
        await start(page, look);
        await openChat(page);
        await ask(page, 'Hi there');
        await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');
        await expectAccessible(page);
      });
    });
  });
}
