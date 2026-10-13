import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  test: {
    include: ['tests/nutrition-sync/connection-ui.test.ts'],
    environment: 'node',
    reporters: ['default', 'json'],
    outputFile: { json: 'test-results/nutrition-connection.json' },
  },
});
