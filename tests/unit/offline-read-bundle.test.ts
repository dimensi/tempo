import { expect, it } from 'vitest';
import { build } from 'esbuild';
it('common cold-launch read screens have no Next router or server dependencies', async () => {
  const output = await build({
    entryPoints: ['src/app/offline-entry.tsx'],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'browser',
    format: 'esm',
    outdir: '/tmp/tempo-unit-memory-only',
    define: {
      'process.env.NODE_ENV': '"production"',
      __OFFLINE_BRAND__: '"/branding/mark.svg"',
    },
    logLevel: 'silent',
  });
  const inputs = Object.keys(output.metafile.inputs);
  expect(
    inputs.some((path) => /next\/dist\/(?:client|server)/.test(path)),
  ).toBe(false);
  expect(inputs.some((path) => path.includes('/server-only/'))).toBe(false);
  expect(inputs).toContain('src/features/anamnesis/workspace.tsx');
});
