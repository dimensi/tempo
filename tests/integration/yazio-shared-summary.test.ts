import { afterEach, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { nutritionUpstream } from '@/server/yazio/adapter';
const token = {
  token_type: 'Bearer',
  access_token: 'synthetic',
  refresh_token: 'synthetic',
  expires_in: 3600,
  expires_at: Date.now() + 3600000,
};
const meals = Object.fromEntries(
  ['breakfast', 'lunch', 'dinner', 'snack'].map((kind) => [
    kind,
    { nutrients: {} },
  ]),
);
const store = () => ({
  load: vi.fn(async () => token),
  save: vi.fn(async () => {}),
});
afterEach(() => vi.restoreAllMocks());
test('one per-run SDK summary fetch supplies independent food and health projections', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ meals, steps: 0, units: { unit_mass: 'kg' } }),
        ),
    );
  const source = await nutritionUpstream(store());
  const [food, health] = await Promise.all([
    source.summary('2026-10-12'),
    source.healthSummary('2026-10-12'),
  ]);
  expect(food.meals).toEqual(meals);
  expect(health).toEqual({
    dailySteps: { source: 'yazio', date: '2026-10-12', steps: 0 },
    unitContext: 'kg',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await source.healthSummary('2026-10-12');
  expect(fetch).toHaveBeenCalledTimes(1);
  await (await nutritionUpstream(store())).summary('2026-10-12');
  expect(fetch).toHaveBeenCalledTimes(2);
});
test('malformed health leaves valid food intact and rejected transport is shared', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response(JSON.stringify({ meals, steps: -1 })),
    );
  const source = await nutritionUpstream(store());
  expect((await source.summary('2026-10-12')).meals).toEqual(meals);
  await expect(source.healthSummary('2026-10-12')).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockRejectedValue(new Error('private synthetic error'));
  await expect(source.summary('2026-10-11')).rejects.toThrow(
    'YAZIO request failed',
  );
  await expect(source.healthSummary('2026-10-11')).rejects.toThrow(
    'YAZIO request failed',
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('valid health projection survives malformed food and missing steps remain unknown', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response(JSON.stringify({ steps: null })),
    );
  const source = await nutritionUpstream(store());
  await expect(source.summary('2026-10-12')).rejects.toThrow(
    'YAZIO request failed',
  );
  expect(await source.healthSummary('2026-10-12')).toEqual({
    dailySteps: { source: 'yazio', date: '2026-10-12', steps: null },
    unitContext: null,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(source.healthSummary('2026-02-30')).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
