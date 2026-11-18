import { expect, test, type Page } from '@playwright/test';

// Light by default, dark on a dark system ('auto'), and theme.mode to pin one.
// Tokens live on the shadow host, so the host's computed style shows them.
const fab = '.cc-fab';

async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((property) => getComputedStyle(document.querySelector('.chatcops-root')!).getPropertyValue(property).trim(), name);
}

async function fabColor(page: Page): Promise<string> {
  return page.locator(fab).evaluate((button) => getComputedStyle(button).backgroundColor);
}

test('auto follows the system setting, and switches while the page is open', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/theme.html');
  await expect(page.locator(fab)).toBeVisible();
  expect(await token(page, '--cc-bg')).toBe('#ffffff');
  expect(await fabColor(page)).toBe('rgb(79, 70, 229)');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => token(page, '--cc-bg')).toBe('#0a0a0a');
  expect(await fabColor(page)).toBe('rgb(99, 102, 241)');

  await page.locator(fab).click();
  await expect(page.locator('.cc-panel')).toHaveClass(/cc-visible/);
  await expect(page.locator('.cc-panel')).toHaveCSS('background-color', 'rgb(10, 10, 10)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.cc-panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('mode pins light or dark whatever the system says', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/theme.html?themeMode=dark');
  await expect(page.locator(fab)).toBeVisible();
  expect(await token(page, '--cc-bg')).toBe('#0a0a0a');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/theme.html?themeMode=light');
  await expect(page.locator(fab)).toBeVisible();
  expect(await token(page, '--cc-bg')).toBe('#ffffff');
});

test('accentDark is the accent in dark mode only', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/theme.html?accent=%23059669&accentDark=%23ffcc00');
  await expect(page.locator(fab)).toBeVisible();
  expect(await fabColor(page)).toBe('rgb(255, 204, 0)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => fabColor(page)).toBe('rgb(5, 150, 105)');
});

test('a dark bgColor from before light mode keeps the dark look on a light system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/theme.html?bgColor=%23111827');
  await expect(page.locator(fab)).toBeVisible();
  expect(await token(page, '--cc-text')).toBe('#ffffff');
  await page.locator(fab).click();
  await expect(page.locator('.cc-panel')).toHaveCSS('background-color', 'rgb(17, 24, 39)');
});
