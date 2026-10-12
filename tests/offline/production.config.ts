import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '..',
  testMatch: ['e2e/offline.spec.ts', 'offline/service-worker.spec.ts'],
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'https://localhost:3160',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    launchOptions: {
      // Chromium SW script fetches require accepted certificates, unlike page ignoreHTTPSErrors.
      // This isolated synthetic localhost browser never changes production TLS or auth.
      args: ['--ignore-certificate-errors'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm exec tsx tests/offline/production-runner.ts',
    url: 'https://localhost:3160/login',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
