import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { checkMeasurementOrigin } from '@/server/measurements';

afterEach(() => vi.unstubAllEnvs());

it('accepts the configured browser origin behind an internal reverse proxy URL', () => {
  vi.stubEnv('BETTER_AUTH_URL', 'https://nutrition.example.test');
  expect(() =>
    checkMeasurementOrigin(
      new Request('http://localhost:3000/api/measurements', {
        headers: { origin: 'https://nutrition.example.test' },
      }),
    ),
  ).not.toThrow();
});

it.each([undefined, 'https://attacker.example.test', 'http://localhost:3000'])(
  'rejects untrusted or missing Origin %s even with spoofed forwarding headers',
  (origin) => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://nutrition.example.test');
    const headers = new Headers({
      'x-forwarded-host': 'attacker.example.test',
      'x-forwarded-proto': 'https',
    });
    if (origin) headers.set('origin', origin);
    expect(() =>
      checkMeasurementOrigin(
        new Request('http://localhost:3000/api/measurements', { headers }),
      ),
    ).toThrow(expect.objectContaining({ status: 403 }));
  },
);
