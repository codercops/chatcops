import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

// Screenshots of the widget's states in light, dark and right-to-left,
// compared with the baselines in e2e/screenshots/. They're made on CI's
// Linux Chromium, so they're skipped anywhere else (a Mac renders fonts
// differently). To make or update them, run the "Update screenshots"
// workflow on your branch; see CONTRIBUTING.md.

const baselines = join(__dirname, '..', 'screenshots', 'visual.spec.ts');
const updating = process.env.E2E_UPDATE_SCREENSHOTS === '1';
const comparable = process.platform === 'linux' && !process.env.E2E_CHANNEL;

test.skip(!comparable, 'Screenshots are compared on CI Linux Chromium only.');
test.skip(!updating && !existsSync(baselines), 'No baselines yet: run the Update screenshots workflow.');

const looks = [
  { name: 'light', config: { theme: { mode: 'light' } } },
  { name: 'dark', config: { theme: { mode: 'dark' } } },
  { name: 'rtl', config: { theme: { mode: 'light' }, dir: 'rtl' } },
] as const;

type Look = (typeof looks)[number];
type Api = { destroy(): void; init(config: object): void };

async function start(page: Page, look: Look, extra: object = {}) {
  await page.emulateMedia({ colorScheme: look.config.theme.mode, reducedMotion: 'reduce' });
  await page.goto('/full.html');
  await page.evaluate((config) => {
    const chat = (window as unknown as { ChatCops: Api }).ChatCops;
    chat.destroy();
    chat.init(config);
  }, { apiUrl: '/api/chat', branding: { name: 'Acme help', subtitle: 'Online' }, ...look.config, ...extra });
}

async function settled(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      [...document.querySelectorAll('.chatcops-root')].flatMap((host) =>
        (host.shadowRoot?.getAnimations() ?? []).map((animation) => animation.finished.catch(() => undefined))
      )
    )
  );
}

async function openChat(page: Page) {
  await page.locator('.cc-fab').click();
  await expect(page.locator('.cc-panel')).toHaveClass(/cc-visible/);
}

async function ask(page: Page, text: string) {
  await page.locator('.cc-input').fill(text);
  await page.locator('.cc-send-btn').click();
}

async function snap(page: Page, target: Locator | Page, name: string) {
  await settled(page);
  await expect(target).toHaveScreenshot(`${name}.png`);
}

for (const look of looks) {
  test.describe(`screenshots, ${look.name}`, () => {
    test('S1 launcher', async ({ page }) => {
      await start(page, look);
      await snap(page, page.locator('.cc-fab'), `s1-launcher-${look.name}`);
    });

    test('S3 welcome bubble', async ({ page }) => {
      await start(page, look, { welcomeBubble: { text: 'Need help choosing a plan?', delay: 0 } });
      await expect(page.locator('.cc-bubble')).toHaveClass(/cc-visible/);
      await snap(page, page.locator('.cc-bubble'), `s3-bubble-${look.name}`);
    });

    test('S4 empty panel with suggestions', async ({ page }) => {
      await start(page, look, { suggestions: ['Pricing', 'Talk to sales'] });
      await openChat(page);
      await snap(page, page.locator('.cc-panel'), `s4-suggestions-${look.name}`);
    });

    test('S5 pre-chat form', async ({ page }) => {
      await start(page, look, {
        preChatForm: {
          enabled: true,
          fields: [
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
          ],
        },
      });
      await openChat(page);
      await expect(page.locator('.cc-prechat')).toBeVisible();
      await snap(page, page.locator('.cc-panel'), `s5-prechat-${look.name}`);
    });

    test('S7 reply with sources', async ({ page }) => {
      await start(page, look);
      await openChat(page);
      await ask(page, 'What does it cost, with sources?');
      await expect(page.locator('.cc-message-sources a')).toHaveText(['Pricing']);
      await snap(page, page.locator('.cc-panel'), `s7-sources-${look.name}`);
    });

    test('S9 error that can be retried', async ({ page }) => {
      await start(page, look);
      await openChat(page);
      await ask(page, 'Please fail midway');
      await expect(page.locator('.cc-message-retry')).toBeVisible();
      await snap(page, page.locator('.cc-panel'), `s9-error-${look.name}`);
    });

    test.describe('S14 on a phone', () => {
      test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

      test('full screen panel with a reply', async ({ page }) => {
        await start(page, look);
        await openChat(page);
        await ask(page, 'Hi there');
        await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');
        await snap(page, page, `s14-phone-${look.name}`);
      });
    });
  });
}
