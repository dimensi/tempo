const config = {
  swSrc: 'src/features/offline/service-worker.ts',
  swDest: 'public/offline-sw.js',
  globDirectory: 'public',
  globPatterns: [],
  disablePrecacheManifest: true,
  esbuildOptions: { minify: true, sourcemap: false, target: 'es2022' },
};

export default config;
