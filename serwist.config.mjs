import { serwist } from '@serwist/next/config';

export function readerManifest(entries) {
  const allowed =
    /^\/offline\/(?:index\.html|assets\/(?:reader-[\w-]+\.(?:js|css)|mark-[a-f0-9]{16}\.svg))$/;
  if (!entries.length || entries.some((entry) => !allowed.test(entry.url)))
    throw new Error('Offline precache contains an unexpected URL');
  if (!entries.some((entry) => entry.url === '/offline/index.html'))
    throw new Error('Offline reader is missing from precache');
  for (const extension of ['js', 'css', 'svg'])
    if (!entries.some((entry) => entry.url.endsWith(`.${extension}`)))
      throw new Error(`Offline reader ${extension} is missing from precache`);
  return { manifest: entries, warnings: [] };
}

const config = await serwist({
  swSrc: 'src/features/offline/service-worker.ts',
  swDest: 'public/offline-sw.js',
  precachePrerendered: false,
  disablePrecacheManifest: false,
  globDirectory: 'public',
  globPatterns: ['offline/assets/*.{js,css,svg}', 'offline/index.html'],
  modifyURLPrefix: { '': '/' },
  esbuildOptions: { minify: true, sourcemap: false, target: 'es2022' },
});
// The Next configurator rewrites index.html to directory routes. This reader is
// a literal public file; replace that transform with a final fail-closed policy.
config.manifestTransforms = [readerManifest];
export default config;
