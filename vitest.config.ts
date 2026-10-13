import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/nutrition-sync/**/*.test.ts',
      'tests/nutrition-scheduler/**/*.test.ts',
    ],
    exclude: ['tests/nutrition-sync/connection-ui.test.ts'],
    environment: 'node',
  },
});
