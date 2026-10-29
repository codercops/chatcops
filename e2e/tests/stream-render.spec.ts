import { expect, test } from '@playwright/test';

// A long reply renders in O(n): finished blocks are rendered once, and only
// the open one re-renders, at most 20 times a second. Before, every chunk
// re-rendered and laid out the whole reply: on this reply that was about
// 1,000 layouts and 8 to 11 s of main thread at 4x throttle, on top of what
// reading the stream costs.
const METRICS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount'] as const;
type Metrics = Record<(typeof METRICS)[number], number>;

test('a 4,000-word reply renders in a bounded number of layouts and little main thread', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.locator('.cc-fab').click();
  await expect(page.locator('.cc-panel')).toHaveClass(/cc-visible/);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const metrics = async (): Promise<Metrics> => {
    const all = (await cdp.send('Performance.getMetrics')).metrics;
    return Object.fromEntries(METRICS.map((name) => [name, all.find((m) => m.name === name)?.value ?? 0])) as Metrics;
  };
  const since = (start: Metrics, end: Metrics) =>
    Object.fromEntries(METRICS.map((name) => [name, name === 'LayoutCount' ? end[name] - start[name] : (end[name] - start[name]) * 1000])) as Metrics;

  // What reading and parsing the same stream costs with no widget work, so
  // the check is on what rendering adds, not on the CI machine's speed.
  const floorStart = await metrics();
  await page.evaluate(async () => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocol: 1, conversationId: crypto.randomUUID(), message: 'long reply' }),
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.startsWith('data: {')) JSON.parse(line.slice(6));
    }
  });
  const floor = since(floorStart, await metrics());

  await page.locator('.cc-input').fill('long reply');
  const start = await metrics();
  await page.locator('.cc-send-btn').click();
  // Checked rarely, so the checks barely add to the measurement.
  await expect
    .poll(() => page.locator('.cc-message-assistant[data-status="complete"]').count(), { intervals: [500], timeout: 60_000 })
    .toBeGreaterThan(0);
  const widget = since(start, await metrics());
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const added = widget.TaskDuration - floor.TaskDuration;
  const summary = `${Math.round(added)} ms added over ${Math.round(floor.TaskDuration)} ms for the stream itself; ${widget.LayoutCount} layouts (${Math.round(widget.LayoutDuration)} ms), script ${Math.round(widget.ScriptDuration)} ms, style ${Math.round(widget.RecalcStyleDuration)} ms`;
  test.info().annotations.push({ type: 'render cost', description: summary });
  console.log(`4,000-word reply at 4x throttle: ${summary}`);

  const reply = page.locator('.cc-message-assistant').last();
  await expect(reply.locator('pre code')).toContainText('npx chatcops test');
  // textContent runs words together across line breaks, so fewer than 4,016.
  expect((await reply.textContent())?.split(/\s+/).length).toBeGreaterThan(3800);
  // About 35 here; a renderer that redoes the whole reply per chunk lays out ~1,000 times.
  expect(widget.LayoutCount).toBeLessThan(100);
  // About 600 ms here against 8 to 11 s before. CI machines vary a lot, so
  // the layout count above is the sharp check and this one only catches the worst.
  expect(added).toBeLessThan(2000);
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
  await expect(page.getByRole('button', { name: 'New reply ↓' })).toBeVisible();
  expect(await log.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.locator('.cc-message-assistant[data-status="complete"]')).toHaveCount(1, { timeout: 45_000 });
  expect(await log.evaluate((el) => el.scrollTop)).toBe(0);
});

test("new reply button scrolls to the latest reply with the keyboard", async ({ page }) => {
  let finish: (body: string) => void = () => {};
  const response = new Promise<string>((resolve) => { finish = resolve; });
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({ contentType: 'text/event-stream', body: await response });
  });
  await page.goto('/');
  await page.locator('.cc-fab').click();
  const log = page.locator('.cc-messages');
  // Seed enough history to exercise real browser scrolling and overlay placement.
  await log.evaluate((el) => {
    for (let i = 0; i < 20; i++) {
      const message = document.createElement('div');
      message.className = 'cc-message cc-message-assistant';
      message.textContent = `Earlier reply ${i}: ${'Some history. '.repeat(10)}`;
      el.appendChild(message);
    }
    el.scrollTop = el.scrollHeight;
  });
  await page.locator('.cc-input').fill('Hello');
  await page.locator('.cc-send-btn').click();
  await expect(page.locator('.cc-typing')).toBeVisible();
  await log.evaluate((el) => { el.scrollTop = 100; });
  finish('data: {"content":"A new reply below the history."}\n\ndata: {"done":true}\n\ndata: [DONE]\n\n');
  await expect(page.locator('.cc-message-assistant').last()).toContainText('A new reply below');
  expect(await log.evaluate((el) => el.scrollTop)).toBe(100);
  const pill = page.getByRole('button', { name: 'New reply ↓' });
  await expect(pill).toBeVisible();
  const logBox = await log.boundingBox();
  const pillBox = await pill.boundingBox();
  expect(pillBox!.y + pillBox!.height).toBeLessThanOrEqual(logBox!.y + logBox!.height);
  await pill.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(pill).toBeFocused();
  await expect(pill).not.toHaveCSS('box-shadow', 'none');
  await page.screenshot({ path: test.info().outputPath('new-reply.png') });
  await pill.press('Enter');
  await expect(pill).toBeHidden();
  await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
});
