import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth/guards', () => ({ authorize: vi.fn() }));
import { authorize } from '@/server/auth/guards';
import { loadAnalytics } from '@/server/analytics/loader';
const range = { from: '2026-10-01', to: '2026-10-03' };
const auth = vi.mocked(authorize);
beforeEach(() => vi.clearAllMocks());
describe('scoped loader', () => {
  it('forbids unauthorized sources before any data call', async () => {
    auth.mockResolvedValue({ ok: false, status: 403 });
    const sources = { listNutritionDays: vi.fn(), listMeasurements: vi.fn() };
    await expect(
      loadAnalytics(new Headers(), 'other-owner', range, sources),
    ).rejects.toMatchObject({ status: 403 });
    expect(sources.listNutritionDays).not.toHaveBeenCalled();
    expect(sources.listMeasurements).not.toHaveBeenCalled();
  });
  it('does not read either source when measurements permission is denied', async () => {
    auth
      .mockResolvedValueOnce({ ok: true, session: {} } as Awaited<
        ReturnType<typeof authorize>
      >)
      .mockResolvedValueOnce({ ok: false, status: 403 });
    const sources = { listNutritionDays: vi.fn(), listMeasurements: vi.fn() };
    await expect(
      loadAnalytics(new Headers(), 'owner', range, sources),
    ).rejects.toMatchObject({ status: 403 });
    expect(sources.listNutritionDays).not.toHaveBeenCalled();
    expect(sources.listMeasurements).not.toHaveBeenCalled();
  });
  it('requires both permissions and passes request owner and range to sources', async () => {
    auth.mockResolvedValue({ ok: true, session: {} } as Awaited<
      ReturnType<typeof authorize>
    >);
    const headers = new Headers();
    const sources = {
      listNutritionDays: vi.fn().mockResolvedValue([]),
      listMeasurements: vi.fn().mockResolvedValue([
        {
          id: 'synthetic',
          ownerId: 'owner',
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
    expect(result.measurements).toEqual([
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
    .mockResolvedValueOnce({ ok: true, session: {} } as Awaited<
      ReturnType<typeof authorize>
    >)
    .mockResolvedValueOnce({ ok: true, session: {} } as Awaited<
      ReturnType<typeof authorize>
    >)
    .mockResolvedValueOnce({ ok: false, status: 403 });
  await expect(
    loadAnalytics(new Headers(), 'owner', range, {
      listNutritionDays: vi.fn().mockResolvedValue([]),
      listMeasurements: vi.fn().mockResolvedValue([]),
    }),
  ).rejects.toMatchObject({ status: 403 });
});
