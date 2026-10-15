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

// Only this operator smoke bundles server-only modules into a non-browser CLI.
await build({
  entryPoints: ['scripts/anamnesis-pdf-smoke.ts'],
  outdir: 'dist-cli',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  external: ['@playwright/test'],
  plugins: [
    {
      name: 'operator-server-only',
      setup(builder) {
        builder.onResolve({ filter: /^server-only$/ }, () => ({
          path: 'server-only',
          namespace: 'operator-server-only',
        }));
        builder.onLoad(
          { filter: /.*/, namespace: 'operator-server-only' },
          () => ({ contents: '', loader: 'js' }),
        );
      },
    },
  ],
});
