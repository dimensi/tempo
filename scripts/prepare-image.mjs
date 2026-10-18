import { cpSync, mkdirSync, rmSync } from 'node:fs';

const destination = '.next/standalone';
cpSync('drizzle', `${destination}/drizzle`, { recursive: true });
cpSync('dist-cli', `${destination}/scripts`, { recursive: true });
cpSync(
  'scripts/pdf-runtime-smoke.mjs',
  `${destination}/scripts/pdf-runtime-smoke.mjs`,
);

// Canonical package directories replace any symlinks emitted by Next tracing.
const sdk = `${destination}/node_modules/@dimensi/yazio`;
rmSync(sdk, { recursive: true, force: true });
mkdirSync(`${sdk}/node_modules`, { recursive: true });
cpSync('vendor/yazio/package.json', `${sdk}/package.json`);
cpSync('vendor/yazio/dist', `${sdk}/dist`, { recursive: true });
cpSync(
  'node_modules/.pnpm/zod@3.25.76/node_modules/zod',
  `${sdk}/node_modules/zod`,
  {
    recursive: true,
  },
);

for (const [store, name] of [
  ['@playwright+test@1.64.0', '@playwright/test'],
  ['playwright@1.64.0', 'playwright'],
  ['playwright-core@1.64.0', 'playwright-core'],
]) {
  const target = `${destination}/node_modules/${name}`;
  rmSync(target, { recursive: true, force: true });
  cpSync(`node_modules/.pnpm/${store}/node_modules/${name}`, target, {
    recursive: true,
  });
}
