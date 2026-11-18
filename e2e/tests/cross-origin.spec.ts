import { expect, test } from '@playwright/test';

const apiUrl = `http://localhost:${process.env.E2E_API_PORT ?? 4174}/api/chat`;
const apiRequestsUrl = `http://localhost:${process.env.E2E_API_PORT ?? 4174}/__test__/api-requests`;
const input = '.cc-input';
const send = '.cc-send-btn';

test('sends a browser CORS preflight before streaming a cross-origin reply', async ({ page, request }) => {
  const beforeResponse = await request.get(apiRequestsUrl);
  const beforeRequests = (await beforeResponse.json()) as ApiRequest[];

  await page.goto('/cross-origin.html');
  await page.locator('.cc-fab').click();
  await expect(page.locator('.cc-panel')).toHaveClass(/cc-visible/);
  await page.locator(input).fill('Cross-origin hello');

  const postResponse = page.waitForResponse(
    (response) => response.url() === apiUrl && response.request().method() === 'POST',
  );
  await page.locator(send).click();

  const post = await postResponse;
  expect(post.status()).toBe(200);
  expect(post.headers()['access-control-allow-origin']).toBe('*');
  await expect(page.locator('.cc-message-assistant').last()).toContainText('Hello from the mock server.');

  const afterResponse = await request.get(apiRequestsUrl);
  const requests = (await afterResponse.json()) as ApiRequest[];
  const observedRequests = requests.slice(beforeRequests.length);
  expect(observedRequests.map(({ method }) => method)).toEqual(['OPTIONS', 'POST']);
  expect(observedRequests[0]).toMatchObject({
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
});

interface ApiRequest {
  method: string;
  status?: number;
  headers?: Record<string, string>;
}
