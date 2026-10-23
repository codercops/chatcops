import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Playwright's CSS locators pierce open shadow roots, so these reach inside the widget.
const fab = '.cc-fab';
const panel = '.cc-panel';
const input = '.cc-input';
const send = '.cc-send-btn';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('starts from the script tag alone', async ({ page }) => {
  await expect(page.locator('#chatcops-root')).toBeAttached();
  await expect(page.locator(fab)).toBeVisible();
  await expect(page.locator(panel)).not.toHaveClass(/cc-visible/);
});

test('streams a reply into the panel', async ({ page }) => {
  await page.locator(fab).click();
  await expect(page.locator(panel)).toHaveClass(/cc-visible/);

  await page.locator(input).fill('Hi there');
  await page.locator(send).click();

  await expect(page.locator('.cc-message-user').last()).toContainText('Hi there');
  await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the test server.');
});

test('Escape closes the popup and returns focus to the launcher', async ({ page }) => {
  await page.locator(fab).click();
  await expect(page.locator(panel)).toHaveClass(/cc-visible/);

  await page.locator(input).focus();
  await page.keyboard.press('Escape');

  await expect(page.locator(panel)).not.toHaveClass(/cc-visible/);
  await expect(page.locator(fab)).toBeFocused();
});

test('the closed popup is not in the tab order', async ({ page }) => {
  await page.locator('#host-button').focus();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    const insidePanel = await page.evaluate(() => {
      const active = document.getElementById('chatcops-root')?.shadowRoot?.activeElement;
      return !!active?.closest('.cc-panel');
    });
    expect(insidePanel).toBe(false);
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the open panel fills the screen', async ({ page }) => {
    await page.locator(fab).click();
    await expect(page.locator(panel)).toHaveClass(/cc-visible/);

    // The panel scales in, so wait for the transition to finish before measuring.
    await expect.poll(async () => {
      const box = await page.locator(panel).boundingBox();
      return box ? [Math.round(box.width), Math.round(box.height)] : null;
    }).toEqual([390, 844]);
  });
});

test('has no serious accessibility violations, closed or open', async ({ page }) => {
  const closed = await new AxeBuilder({ page }).include('#chatcops-root').analyze();
  expect(seriousOrWorse(closed.violations)).toEqual([]);

  await page.locator(fab).click();
  await expect(page.locator(panel)).toHaveClass(/cc-visible/);
  await page.locator(input).fill('Hi there');
  await page.locator(send).click();
  await expect(page.locator('.cc-message-assistant').last()).toContainText('test server');

  const open = await new AxeBuilder({ page }).include('#chatcops-root').analyze();
  expect(seriousOrWorse(open.violations)).toEqual([]);
});

function seriousOrWorse(violations: Array<{ id: string; impact?: string | null; nodes: unknown[] }>) {
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}, ${v.nodes.length} nodes)`);
}

test('a reply that fails partway keeps its text and shows the error under it', async ({ page }) => {
  await page.locator(fab).click();
  await page.locator(input).fill('Please fail midway');
  await page.locator(send).click();

  const reply = page.locator('.cc-message-assistant').last();
  await expect(reply.locator('.cc-message-error-note')).toBeVisible();
  await expect(reply.locator('.cc-message-content')).toHaveText('Hello from the');
  await expect(reply.locator('.cc-message-retry')).toBeVisible();

  const results = await new AxeBuilder({ page }).include('#chatcops-root').analyze();
  expect(seriousOrWorse(results.violations)).toEqual([]);
});

test('a reply cut off without [DONE] keeps its text and offers a retry', async ({ page }) => {
  await page.locator(fab).click();
  await page.locator(input).fill('Please cut off');
  await page.locator(send).click();

  const reply = page.locator('.cc-message-assistant').last();
  await expect(reply.locator('.cc-message-error-note')).toBeVisible();
  await expect(reply.locator('.cc-message-content')).toHaveText('Hello from the');
  await expect(reply.locator('.cc-message-retry')).toBeVisible();
});
