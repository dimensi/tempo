import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  test: {
    include: ['tests/nutrition-scheduler/**/*.test.ts'],
    environment: 'node',
  },
});
