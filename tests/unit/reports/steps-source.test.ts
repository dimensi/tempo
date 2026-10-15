import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { getAccessibleOwnerId, getStepsSummary } = vi.hoisted(() => ({
  getAccessibleOwnerId: vi.fn(async () => 'owner'),
  getStepsSummary: vi.fn(async () => ({
    days: [{ date: '2026-10-10', steps: 0, source: 'YAZIO' }],
  })),
}));
vi.mock('@/server/access/owner', () => ({ getAccessibleOwnerId }));
vi.mock('@/server/health/readers', () => ({ getStepsSummary }));
import { reportDataSource } from '@/server/pdf/source';

it('reads authenticated steps for the requested period and rejects a different owner before reading', async () => {
  const headers = new Headers();
  const source = reportDataSource(headers);
  const signal = new AbortController().signal;
  await expect(
    source.getSteps('owner', '2026-10-10', '2026-10-11', signal),
  ).resolves.toEqual([{ date: '2026-10-10', steps: 0, source: 'YAZIO' }]);
  expect(getStepsSummary).toHaveBeenCalledWith(headers, {
    from: '2026-10-10',
    to: '2026-10-11',
  });
  getStepsSummary.mockClear();
  getAccessibleOwnerId.mockResolvedValueOnce('another-owner');
  await expect(
    source.getSteps('owner', '2026-10-10', '2026-10-11', signal),
  ).rejects.toMatchObject({ status: 403 });
  expect(getStepsSummary).not.toHaveBeenCalled();
  const aborted = AbortSignal.abort();
  await expect(
    source.getSteps('owner', '2026-10-10', '2026-10-11', aborted),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(getStepsSummary).not.toHaveBeenCalled();
});
