import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { testOrigin } from './origin';

export function productionConfig(
  family: 'smoke' | 'nutrition',
  testMatch: string[],
) {
  return defineConfig({
    testDir: fileURLToPath(new URL('../', import.meta.url)),
    testMatch,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: family === 'nutrition' ? 90000 : 60000,
    outputDir: fileURLToPath(
      new URL(`../../test-results/${family}`, import.meta.url),
    ),
    reporter: 'list',
    use: {
      baseURL: testOrigin,
      ignoreHTTPSErrors: true,
      trace: 'retain-on-failure',
      serviceWorkers: 'block',
      launchOptions: { args: ['--ignore-certificate-errors'] },
    },
    projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
      command: `pnpm exec tsx tests/smoke/production-runner.ts ${family}`,
      url: `${testOrigin}/login`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 120000,
    },
  });
}
