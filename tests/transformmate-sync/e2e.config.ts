import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  use: { baseURL: 'http://localhost:3157', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm exec tsx tests/transformmate-sync/runner.ts',
    url: 'http://localhost:3157/login',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
