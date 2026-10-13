import { defineConfig, devices } from '@playwright/test';
import { testOrigin } from './origin';
import { fileURLToPath } from 'node:url';
export function productionConfig(
  family: string,
  testMatch: string[],
  mobile = true,
) {
  return defineConfig({
    testDir: fileURLToPath(new URL('../', import.meta.url)),
    testMatch,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: ['general', 'offline', 'smoke'].includes(family) ? 60000 : 120000,
    outputDir: fileURLToPath(
      new URL(`../../test-results/${family}/artifacts`, import.meta.url),
    ),
    reporter: [
      ['list'],
      [
        'json',
        {
          outputFile: fileURLToPath(
            new URL(`../../test-results/${family}.json`, import.meta.url),
          ),
        },
      ],
    ],
    use: {
      baseURL: testOrigin,
      ignoreHTTPSErrors: true,
      trace: 'retain-on-failure',
      serviceWorkers: ['offline', 'smoke'].includes(family) ? 'allow' : 'block',
      launchOptions: { args: ['--ignore-certificate-errors'] },
    },
    projects: [
      { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
      ...(mobile
        ? [
            {
              name: 'mobile',
              use: {
                ...devices['iPhone 13'],
                defaultBrowserType: 'chromium' as const,
              },
            },
          ]
        : []),
    ],
    webServer: {
      command: `pnpm exec tsx tests/offline/production-runner.ts ${family}`,
      url: `${testOrigin}/login`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 120000,
    },
  });
}
