import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    'better-sqlite3',
    '@napi-rs/canvas',
    '@playwright/test',
    'playwright',
    'playwright-core',
  ],
  outputFileTracingIncludes: {
    '/api/anamnesis/**': ['node_modules/.pnpm/@napi-rs+canvas*/**/*'],
    '/api/reports': [
      'node_modules/.pnpm/@playwright+test@1.64.0/node_modules/@playwright/test/**/*',
      'node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/**/*',
      'node_modules/.pnpm/playwright-core@1.64.0/node_modules/playwright-core/**/*',
    ],
  },
  experimental: {
    agentUpgrade: 'security',
    optimizePackageImports: [
      '@mantine/core',
      '@mantine/hooks',
      '@tabler/icons-react',
    ],
  },
};
export default config;
