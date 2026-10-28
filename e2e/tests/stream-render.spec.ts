import { expect, test } from '@playwright/test';

// A long reply renders in O(n): finished blocks are rendered once, and only
// the open one re-renders, at most once a frame. Before, every chunk
// re-rendered the whole reply, which grows with the square of its length.
test('a 4,000-word reply costs under 150 ms of main thread at 4x CPU throttle', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.locator('.cc-fab').click();
  await expect(page.locator('.cc-panel')).toHaveClass(/cc-visible/);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const busySeconds = async () => (await cdp.send('Performance.getMetrics')).metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? 0;

  await page.locator('.cc-input').fill('long reply');
  const before = await busySeconds();
  await page.locator('.cc-send-btn').click();
  // Checked rarely, so the checks themselves barely add to the measurement.
  await expect
    .poll(() => page.locator('.cc-message-assistant[data-status="complete"]').count(), { intervals: [500], timeout: 45_000 })
    .toBeGreaterThan(0);
  const ms = ((await busySeconds()) - before) * 1000;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  test.info().annotations.push({ type: 'main thread', description: `${ms.toFixed(0)} ms` });
  console.log(`4,000-word reply: ${ms.toFixed(0)} ms of main thread at 4x throttle`);
  const reply = page.locator('.cc-message-assistant').last();
  await expect(reply.locator('pre code')).toContainText('npx chatcops test');
  expect((await reply.textContent())?.split(/\s+/).length).toBeGreaterThan(3900);
  expect(ms).toBeLessThan(150);
});

test("new text doesn't pull the log down while the visitor reads above it", async ({ page }) => {
  await page.goto('/');
  await page.locator('.cc-fab').click();
  await page.locator('.cc-input').fill('long reply');
  await page.locator('.cc-send-btn').click();
  const log = page.locator('.cc-messages');
  await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(400);
  await log.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(500);
  expect(await log.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.locator('.cc-message-assistant[data-status="complete"]')).toHaveCount(1, { timeout: 45_000 });
  expect(await log.evaluate((el) => el.scrollTop)).toBe(0);
});
