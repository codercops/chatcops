import { expect, test } from '@playwright/test';

test('a popup and an inline widget on one page keep separate conversations', async ({ page }) => {
  const conversationIds: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/chat') && request.method() === 'POST') {
      conversationIds.push(request.postDataJSON().conversationId);
    }
  });

  await page.goto('/two-widgets.html');
  const popup = page.locator('#chatcops-root');
  const inline = page.locator('#inline-box .chatcops-root');
  await expect(popup).toBeAttached();
  await expect(inline).toBeAttached();
  await expect(inline).toHaveAttribute('id', 'chatcops-root-2');

  await inline.locator('.cc-input').fill('From the inline widget');
  await inline.locator('.cc-send-btn').click();
  await expect(inline.locator('.cc-message-assistant').last()).toContainText('test server');

  await popup.locator('.cc-fab').click();
  await popup.locator('.cc-input').fill('From the popup');
  await popup.locator('.cc-send-btn').click();
  await expect(popup.locator('.cc-message-assistant').last()).toContainText('test server');

  expect(conversationIds).toHaveLength(2);
  expect(conversationIds[0]).not.toBe(conversationIds[1]);

  // Each transcript only shows its own messages.
  await expect(popup.locator('.cc-message-user')).toHaveText(['From the popup']);
  await expect(inline.locator('.cc-message-user')).toHaveText(['From the inline widget']);

  // Destroying the inline widget leaves the popup mounted.
  await page.evaluate(() => (window as unknown as { inlineWidget: { destroy(): void } }).inlineWidget.destroy());
  await expect(inline).toHaveCount(0);
  await expect(popup).toBeAttached();
  await expect(popup.locator('.cc-fab')).toBeVisible();
});
