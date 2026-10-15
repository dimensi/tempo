import { afterEach, expect, it, vi } from 'vitest';
import type { AnalyticsData } from '@/contracts/analytics';
const harness = vi.hoisted(() => ({
  savedAt: 0,
  update: () => {},
  setData: vi.fn(),
  project: vi.fn(() => ({ range: {} })),
}));
vi.mock('react', () => ({
  useState: (value: unknown) => [
    typeof value === 'function' ? value() : value,
    harness.setData,
  ],
  useEffect: (effect: () => unknown) => effect(),
}));
vi.mock('@/features/analytics/read', () => ({
  AnalyticsDashboard: () => null,
}));
vi.mock('@/lib/use-read-refresh', () => ({ useReadRefresh: () => 0 }));
vi.mock('@/app/offline-model', () => ({ savedAnalytics: harness.project }));
vi.mock('@/lib/offline-controller', () => ({
  getOfflineController: () => ({
    getSnapshot: () => ({
      status: 'ready',
      bundle: {
        savedAt: harness.savedAt,
        snapshot: {
          views: { summary: { from: '2026-10-01', to: '2026-10-15' } },
        },
      },
    }),
    subscribe: (update: () => void) => {
      harness.update = update;
      return () => {};
    },
  }),
}));
import { LiveAnalytics } from '@/app/live-analytics';
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it('keeps fresh server analytics until the snapshot is newer than the mounted server model', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  harness.savedAt = 999;
  LiveAnalytics({
    initial: {
      range: { from: '2026-10-01', to: '2026-10-15' },
      canSync: true,
    } as AnalyticsData,
    navigationSlot: null,
  });
  await Promise.resolve();
  expect(harness.project).not.toHaveBeenCalled();
  expect(harness.setData).not.toHaveBeenCalled();
  harness.savedAt = 1001;
  harness.update();
  expect(harness.project).toHaveBeenCalledOnce();
  expect(harness.setData).toHaveBeenCalledOnce();
});
