import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const apiPort = Number(process.env.E2E_API_PORT ?? 4174);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
