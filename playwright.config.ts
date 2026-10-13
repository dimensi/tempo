import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.E2E_PORT ?? '3100');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('E2E_PORT must be an integer between 1024 and 65535');
const baseURL = `http://localhost:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/offline.spec.ts'],
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // Keep page.route fixtures interceptable; the production offline suite tests the real worker.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: `pnpm exec tsx scripts/prepare-e2e.ts && pnpm dev --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: 'file:./.data/e2e.sqlite',
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: 'e2e-only-secret-not-a-production-secret-12345',
      DEMO_MODE: 'false',
    },
    timeout: 120000,
  },
});
