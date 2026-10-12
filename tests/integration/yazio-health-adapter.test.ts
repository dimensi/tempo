import { afterEach, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { Yazio } from '@dimensi/yazio';
import {
  yazioHealthUpstream,
  YazioHealthReadError,
} from '@/server/yazio/health-adapter';
afterEach(() => vi.restoreAllMocks());
const client = () =>
  new Yazio({
    token: {
      token_type: 'Bearer',
      access_token: 'synthetic',
      refresh_token: 'synthetic',
      expires_in: 3600,
      expires_at: Date.now() + 3600000,
    },
  });
test('packaged SDK health reads use exact calendar date and GET only', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ steps: 0, units: { unit_mass: 'kg' } })),
    )
    .mockResolvedValueOnce(new Response('null'));
  const upstream = yazioHealthUpstream(client().user);
  const summary = await upstream.summary('2026-10-12');
  expect(summary.dailySteps.steps).toBe(0);
  expect(await upstream.weight('2026-10-12', summary.unitContext)).toBeNull();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    'https://yzapi.yazio.com/v20/user/widgets/daily-summary?date=2026-10-12',
    'https://yzapi.yazio.com/v20/user/bodyvalues/weight/last?date=2026-10-12',
  ]);
  for (const [, init] of fetch.mock.calls)
    expect(init?.method ?? 'GET').toBe('GET');
});
test('invalid input avoids upstream; malformed wire/errors expose sanitized health code', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{"steps":-1}'));
  const upstream = yazioHealthUpstream(client().user);
  await expect(upstream.summary('2026-02-30')).rejects.toBeInstanceOf(
    YazioHealthReadError,
  );
  expect(fetch).not.toHaveBeenCalled();
  await expect(upstream.summary('2026-10-12')).rejects.toMatchObject({
    code: 'HEALTH_READ_FAILED',
    message: 'YAZIO health read failed',
  });
  fetch.mockRejectedValue(new Error('synthetic private upstream detail'));
  await expect(upstream.weight('2026-10-12', null)).rejects.toMatchObject({
    message: 'YAZIO health read failed',
  });
});
