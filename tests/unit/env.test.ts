import { expect, it } from 'vitest';
import { readServerEnv } from '@/server/env';
it('forbids production demo and missing or insecure authentication configuration', () => {
  expect(() => readServerEnv({ NODE_ENV: 'production' })).toThrow();
  expect(() =>
    readServerEnv({
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'a'.repeat(48),
      BETTER_AUTH_URL: 'http://example.com',
    }),
  ).toThrow();
  expect(() =>
    readServerEnv({
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'a'.repeat(48),
      BETTER_AUTH_URL: 'https://example.com',
      DEMO_MODE: 'true',
    }),
  ).toThrow();
  expect(
    readServerEnv({
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'a'.repeat(48),
      BETTER_AUTH_URL: 'https://example.com',
    }).DEMO_MODE,
  ).toBe('false');
});
