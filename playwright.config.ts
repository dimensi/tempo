import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm exec tsx scripts/prepare-e2e.ts && pnpm dev --port 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    env: {
      DATABASE_URL: 'file:./.data/e2e.sqlite',
      BETTER_AUTH_URL: 'http://localhost:3100',
      BETTER_AUTH_SECRET: 'e2e-only-secret-not-a-production-secret-12345',
      DEMO_MODE: 'false',
    },
    timeout: 120000,
  },
});
