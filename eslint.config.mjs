import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features/*/*',
                '!@/features/nutrition/read',
                '!@/features/workouts/read',
                '!@/features/overview/read',
                '!@/features/analytics/read',
              ],
              message:
                'Import only a feature public entry point; shared contracts belong in src/contracts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/components/**/*.{ts,tsx}',
      'src/lib/**/*.{ts,tsx}',
      'src/contracts/**/*.ts',
      'src/config/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/server/**',
                '@dimensi/yazio',
                'better-sqlite3',
                'drizzle-orm',
                'drizzle-orm/**',
              ],
              message:
                'Server implementation must not enter shared/client modules.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    '.agents/',
    '.next/**',
    'public/offline/assets/**',
    'public/offline-sw.js',
    'next-env.d.ts',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
  ]),
]);
