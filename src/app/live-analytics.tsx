'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AnalyticsDashboard } from '@/features/analytics/read';
import type { AnalyticsData } from '@/contracts/analytics';
import { getOfflineController } from '@/lib/offline-controller';
import { useReadRefresh } from '@/lib/use-read-refresh';
import { savedAnalytics } from './offline-model';
/** SSR seed and bounded local observations share the ordinary analytics renderer. */
export function LiveAnalytics({
  initial,
  navigationSlot,
}: {
  initial: AnalyticsData;
  navigationSlot: ReactNode;
}) {
  const [data, setData] = useState(initial);
  const refresh = useReadRefresh();
  const [initialAt] = useState(Date.now);
  useEffect(() => {
    const controller = getOfflineController();
    const update = () => {
      const bundle = controller.getSnapshot().bundle;
      const snapshot = bundle?.snapshot;
      if (!snapshot || !bundle || bundle.savedAt <= initialAt) return;
      // A bounded cache cannot replace a wider successful server result online.
      if (
        initial.range.from < (snapshot.views.summary?.from ?? '') ||
        initial.range.to > (snapshot.views.summary?.to ?? '')
      )
        return;
      const next = savedAnalytics(
        snapshot,
        initial.range,
        initial.today,
        initial.timezone,
      );
      if (next)
        setData({
          ...next,
          canSync:
            initial.canSync && controller.getSnapshot().status === 'ready',
        });
    };
    const stop = controller.subscribe(update);
    void Promise.resolve().then(update);
    return stop;
  }, [initial, initialAt, refresh]);
  return <AnalyticsDashboard data={data} navigationSlot={navigationSlot} />;
}
