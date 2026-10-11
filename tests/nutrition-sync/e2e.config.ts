import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  workers: 1,
  timeout: 120000,
  use: { baseURL: 'http://localhost:3135', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec tsx scripts/prepare-e2e.ts && pnpm dev --port 3135',
    url: 'http://localhost:3135/login',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_URL: 'file:./.data/e2e.sqlite',
      BETTER_AUTH_URL: 'http://localhost:3135',
      BETTER_AUTH_SECRET: 'e2e-only-secret-not-a-production-secret-12345',
      UPLOADS_DIR: './.data/e2e-nutrition-uploads',
      YAZIO_TOKEN_FILE: '',
      DEMO_MODE: 'false',
    },
  },
});
