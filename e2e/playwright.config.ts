import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const apiPort = Number(process.env.E2E_API_PORT ?? 4174);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // Screenshot baselines (visual.spec.ts), made on CI's Linux Chromium only.
  snapshotPathTemplate: '{testDir}/../screenshots/{testFilePath}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  // E2E_CHANNEL=chrome runs the tests in your installed Chrome, without downloading Chromium.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}) } }],
  webServer: [
    {
      command: 'node e2e/server.mjs page',
      cwd: '..',
      url: `http://localhost:${port}/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/server.mjs api',
      cwd: '..',
      url: `http://localhost:${apiPort}/__test__/api-requests`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
