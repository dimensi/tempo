import { build } from 'esbuild';
await build({
  entryPoints: [
    'scripts/migrate.ts',
    'scripts/create-user.ts',
    'scripts/backup.ts',
    'scripts/seed.ts',
  ],
  outdir: 'dist-cli',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
