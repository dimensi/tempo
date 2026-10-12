import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  copyFile,
} from 'node:fs/promises';
const root = 'public/offline';
const directory = `${root}/assets`;
await rm(root, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const brand = await readFile('public/branding/mark.svg');
const brandName = `mark-${createHash('sha256').update(brand).digest('hex').slice(0, 16)}.svg`;
await copyFile('public/branding/mark.svg', `${directory}/${brandName}`);
await build({
  entryPoints: ['src/features/offline/entry.tsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outdir: directory,
  entryNames: 'reader-[hash]',
  minify: true,
  sourcemap: false,
  tsconfig: 'tsconfig.json',
  define: {
    'process.env.NODE_ENV': '"production"',
    __OFFLINE_BRAND__: JSON.stringify(`/offline/assets/${brandName}`),
  },
  logLevel: 'warning',
});
const files = (await readdir(directory)).sort();
const js = files.find((file) => file.endsWith('.js'));
const css = files.find((file) => file.endsWith('.css'));
if (!js || !css) throw new Error('Offline assets missing');
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Offline-чтение · Питание и движение</title><link rel="stylesheet" href="/offline/assets/${css}"></head><body><div id="offline-root"></div><script type="module" src="/offline/assets/${js}"></script></body></html>`;
await writeFile(`${root}/index.html`, html);
console.info(`Offline reader: ${files.length} static assets`);
