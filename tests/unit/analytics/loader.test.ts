import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth/guards', () => ({ authorize: vi.fn() }));
import { authorize } from '@/server/auth/guards';
import { loadAnalytics } from '@/server/analytics/loader';
import { normalizeDay } from '@/features/nutrition/domain';
import { rangeDates } from '@/features/analytics/range';
const healthSources = () => ({
  weight: vi.fn().mockResolvedValue({ range, local: [], imported: [] }),
  steps: vi.fn().mockImplementation((_headers, _owner, period) =>
    Promise.resolve({
      summary: {
        range: period,
        days: [],
        observedDays: 0,
        totalSteps: null,
        averageSteps: null,
      },
      updatedAt: null,
    }),
  ),
});
const range = { from: '2026-10-01', to: '2026-10-03' };
const auth = vi.mocked(authorize);
beforeEach(() => vi.clearAllMocks());
describe('scoped loader', () => {
  it('forbids unauthorized sources before any data call', async () => {
    auth.mockResolvedValue({ ok: false, status: 403 });
    const sources = {
      ...healthSources(),
      listNutritionDays: vi.fn(),
      listMeasurements: vi.fn(),
    };
    await expect(
      loadAnalytics(new Headers(), 'other-owner', range, sources),
    ).rejects.toMatchObject({ status: 403 });
    expect(sources.listNutritionDays).not.toHaveBeenCalled();
    expect(sources.listMeasurements).not.toHaveBeenCalled();
  });
  it('does not read either source when measurements permission is denied', async () => {
    auth
      .mockResolvedValueOnce({
        ok: true,
        session: { user: { role: 'OWNER' } },
      } as Awaited<ReturnType<typeof authorize>>)
      .mockResolvedValueOnce({ ok: false, status: 403 });
    const sources = {
      ...healthSources(),
      listNutritionDays: vi.fn(),
      listMeasurements: vi.fn(),
    };
    await expect(
      loadAnalytics(new Headers(), 'owner', range, sources),
    ).rejects.toMatchObject({ status: 403 });
    expect(sources.listNutritionDays).not.toHaveBeenCalled();
    expect(sources.listMeasurements).not.toHaveBeenCalled();
  });
  it('requires both permissions and passes request owner and range to sources', async () => {
    auth.mockResolvedValue({
      ok: true,
      session: { user: { role: 'OWNER' } },
    } as Awaited<ReturnType<typeof authorize>>);
    const headers = new Headers();
    const sources = {
      ...healthSources(),
      listNutritionDays: vi.fn().mockResolvedValue([]),
      listMeasurements: vi.fn().mockResolvedValue([
        {
          id: 'synthetic',
          ownerId: 'owner',
          sync: [],
          measuredAt: '2026-10-02',
          values: [{ metric: 'weight', value: '80.125', unit: 'kg' }],
          note: 'must not reach browser',
        },
      ]),
    };
    const result = await loadAnalytics(headers, 'owner', range, sources);
    expect(auth.mock.calls).toEqual([
      [headers, 'nutrition:read', 'owner'],
      [headers, 'measurements:read', 'owner'],
      [headers, 'nutrition:read', 'owner'],
      [headers, 'measurements:read', 'owner'],
    ]);
    expect(sources.listNutritionDays).toHaveBeenCalledWith(
      headers,
      'owner',
      range,
    );
    expect(sources.listMeasurements).toHaveBeenCalledWith(headers, 'owner');
    expect(result.body.state).toBe('ready');
    expect(
      result.body.state === 'ready' ? result.body.data.measurements : null,
    ).toEqual([
      {
        id: 'synthetic',
        measuredAt: '2026-10-02',
        values: [{ metric: 'weight', value: '80.125', unit: 'kg' }],
      },
    ]);
  });
});

it('blocks a grant revoked during source reads', async () => {
  auth
    .mockResolvedValueOnce({
      ok: true,
      session: { user: { role: 'OWNER' } },
    } as Awaited<ReturnType<typeof authorize>>)
    .mockResolvedValueOnce({
      ok: true,
      session: { user: { role: 'OWNER' } },
    } as Awaited<ReturnType<typeof authorize>>)
    .mockResolvedValueOnce({ ok: false, status: 403 });
  await expect(
    loadAnalytics(new Headers(), 'owner', range, {
      ...healthSources(),
      listNutritionDays: vi.fn().mockResolvedValue([]),
      listMeasurements: vi.fn().mockResolvedValue([]),
    }),
  ).rejects.toMatchObject({ status: 403 });
});

it('isolates a failed activity source while retaining nutrition and body', async () => {
  auth.mockResolvedValue({
    ok: true,
    session: { user: { role: 'OWNER' } },
  } as Awaited<ReturnType<typeof authorize>>);
  const result = await loadAnalytics(new Headers(), 'owner', range, {
    ...healthSources(),
    steps: vi.fn().mockRejectedValue(new Error('private upstream failure')),
    listNutritionDays: vi.fn().mockResolvedValue([]),
    listMeasurements: vi.fn().mockResolvedValue([]),
  });
  expect(result.activity).toEqual({ state: 'error' });
  expect(result.nutrition.state).toBe('ready');
  expect(result.body.state).toBe('ready');
  expect(JSON.stringify(result)).not.toContain('private upstream');
});
it('does not discard current data when only comparison loading fails', async () => {
  auth.mockResolvedValue({
    ok: true,
    session: { user: { role: 'OWNER' } },
  } as Awaited<ReturnType<typeof authorize>>);
  const result = await loadAnalytics(new Headers(), 'owner', range, {
    ...healthSources(),
    listNutritionDays: vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('previous failure')),
    listMeasurements: vi.fn().mockResolvedValue([]),
  });
  expect(result.nutrition).toMatchObject({
    state: 'ready',
    comparison: null,
    comparisonUnavailable: true,
  });
});
it('rejects source authorization failures rather than treating them as unavailable', async () => {
  auth.mockResolvedValue({
    ok: true,
    session: { user: { role: 'TRAINER' } },
  } as Awaited<ReturnType<typeof authorize>>);
  await expect(
    loadAnalytics(new Headers(), 'owner', range, {
      ...healthSources(),
      steps: vi.fn().mockRejectedValue({ status: 403 }),
      listNutritionDays: vi.fn().mockResolvedValue([]),
      listMeasurements: vi.fn().mockResolvedValue([]),
    }),
  ).rejects.toMatchObject({ status: 403 });
});
it('validates range/timezone before reading and computes user-local today', async () => {
  auth.mockResolvedValue({
    ok: true,
    session: { user: { role: 'OWNER' } },
  } as Awaited<ReturnType<typeof authorize>>);
  const sources = {
    ...healthSources(),
    listNutritionDays: vi.fn().mockResolvedValue([]),
    listMeasurements: vi.fn().mockResolvedValue([]),
  };
  await expect(
    loadAnalytics(new Headers(), 'owner', range, sources, 'invalid/timezone'),
  ).rejects.toMatchObject({ status: 400 });
  expect(sources.listNutritionDays).not.toHaveBeenCalled();
  const result = await loadAnalytics(
    new Headers(),
    'owner',
    range,
    sources,
    'America/Los_Angeles',
    new Date('2026-10-14T01:00:00Z'),
  );
  expect(result.today).toBe('2026-10-13');
  expect(result.previousRange).toEqual({
    from: '2026-09-28',
    to: '2026-09-30',
  });
});

it('suppresses calorie comparisons with low complete-day coverage despite fully known calories', async () => {
  auth.mockResolvedValue({
    ok: true,
    session: { user: { role: 'OWNER' } },
  } as Awaited<ReturnType<typeof authorize>>);
  const records = (period: typeof range) =>
    rangeDates(period).map((date) =>
      normalizeDay({
        date,
        fetchedAt: '2026-10-14T00:00:00Z',
        products: {},
        recipes: {},
        summary: { meals: {} },
        items: {
          products: [],
          recipe_portions: [],
          simple_products: [
            {
              id: date,
              date: `${date} 12:00:00`,
              daytime: 'lunch',
              name: 'Synthetic',
              is_ai_generated: false,
              nutrients: {
                'energy.energy': '2000',
                'nutrient.protein': null,
                'nutrient.fat': '1',
                'nutrient.carb': '2',
              },
            },
          ],
        },
      }),
    );
  const result = await loadAnalytics(new Headers(), 'owner', range, {
    ...healthSources(),
    listMeasurements: vi.fn().mockResolvedValue([]),
    listNutritionDays: vi
      .fn()
      .mockImplementation((_headers, _owner, period) =>
        Promise.resolve(records(period)),
      ),
  });
  expect(result.nutrition).toMatchObject({
    state: 'ready',
    data: { calorieDays: 3, completeDays: 0, calorieMean: '2000' },
    comparison: null,
  });
  expect(result.highlights.some((item) => item.kind === 'calories')).toBe(
    false,
  );
});
