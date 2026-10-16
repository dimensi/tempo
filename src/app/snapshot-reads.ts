import { useMemo, useSyncExternalStore } from 'react';
import type { OfflineSnapshot } from '@/contracts/offline';
import { useReadOnline } from '@/lib/use-read-online';
import { getOfflineController } from '@/lib/offline-controller';
import {
  bindReadScope,
  canonicalReadKey,
  clientReads,
  refreshClientRead,
} from '@/lib/client-read';
import { readContextSchema } from '@/contracts/read-context';
import { readResponseSchema } from '@/contracts/read-resources';
import { browserToday } from '@/components/shared/date-navigation-dates';
import { presetRange } from '@/features/analytics/read';
import { summarizeSteps } from '@/lib/steps-summary';
import { shiftDate } from '@/contracts/nutrition-sync-dates';
import {
  savedDiaryDay,
  savedMeasurements,
  savedWeight,
  savedOverview,
  savedAnalytics,
} from './offline-model';

/** Snapshot projection is an app adapter; feature modules only receive their usual DTOs. */
export function installSnapshotReads() {
  const controller = getOfflineController();
  let active = true;
  let warming = '';
  const project = async () => {
    bindReadScope();
    const bundle = controller.getSnapshot().bundle;
    if (!bundle) return;
    await clientReads.restore('/api/read/context');
    if (!active || controller.getSnapshot().bundle !== bundle) return;
    const body = clientReads.snapshot('/api/read/context').data;
    const context = body && readContextSchema.safeParse(JSON.parse(body));
    if (
      !context ||
      !context.success ||
      context.data.partition !== bundle.snapshot.partition ||
      context.data.connectionGeneration !== bundle.snapshot.connectionGeneration
    )
      return;
    const { ownerId } = context.data;
    const snapshot = bundle.snapshot;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = browserToday();
    const put = (
      href: string,
      data: unknown,
      coverage: 'complete' | 'partial' = 'complete',
    ) => {
      const key = canonicalReadKey(new URL(href, location.origin));
      const existing = clientReads.snapshot(key);
      if (
        existing.data !== undefined &&
        (existing.source !== 'storage' ||
          (existing.savedAt ?? 0) >= bundle.savedAt)
      )
        return;
      const schema = readResponseSchema(new URL(key, location.origin).pathname);
      const parsed = schema?.safeParse(data);
      if (parsed?.success)
        clientReads.seed(
          key,
          JSON.stringify(parsed.data),
          bundle.savedAt,
          'storage',
          coverage,
        );
    };
    const query = (from: string, to: string) =>
      new URLSearchParams({ ownerId, from, to });
    for (const day of snapshot.diary) {
      put(`/api/nutrition/days?${query(day.date, day.date)}`, [
        savedDiaryDay(snapshot, day.date),
      ]);
      put(
        `/api/nutrition/photos?${query(day.date, day.date)}`,
        snapshot.photos.items
          .filter((photo) => photo.date === day.date)
          .map(({ id, date, daytime, source, observedAt }) => ({
            id,
            date,
            daytime,
            source,
            observedAt,
          })),
      );
      const rows = snapshot.views.comments.filter(
        (row) => row.target === `/diary?date=${day.date}`,
      );
      if (snapshot.views.commentsComplete || rows.length)
        put(
          `/api/comments?${new URLSearchParams({ ownerId, type: 'nutrition_day', targetId: day.date })}`,
          rows.map((row) => ({
            id: row.key,
            authorId: null,
            authorName: row.authorName,
            body: row.body,
            parentId: row.parentKey,
            createdAt: row.createdAt,
            updatedAt: row.createdAt,
            canEdit: false,
          })),
          snapshot.views.commentsComplete ? 'complete' : 'partial',
        );
    }
    put(
      `/api/measurements?ownerId=${encodeURIComponent(ownerId)}`,
      savedMeasurements(snapshot).map((row) => ({ ...row, ownerId })),
      'partial',
    );
    const range = { from: shiftDate(today, -365), to: today };
    put(
      `/api/health/weight?${new URLSearchParams(range)}`,
      savedWeight(snapshot, range),
      'partial',
    );
    const overview = savedOverview(snapshot, today, timezone);
    if (overview)
      put(
        `/api/overview?timezone=${encodeURIComponent(timezone)}`,
        overview,
        'partial',
      );
    const week = presetRange('week', today);
    if (snapshot.views.summary)
      put(
        `/api/health/steps?from=${week.from}&to=${week.to}`,
        summarizeSteps(week, snapshot.views.summary.steps),
        'partial',
      );
    const url = new URL(location.href);
    const period =
      url.pathname === '/analytics' &&
      url.searchParams.has('from') &&
      url.searchParams.has('to')
        ? {
            from: url.searchParams.get('from')!,
            to: url.searchParams.get('to')!,
          }
        : week;
    if (
      snapshot.views.summary &&
      period.from >= snapshot.views.summary.from &&
      period.to <= snapshot.views.summary.to
    ) {
      const zone = url.searchParams.get('timezone') ?? timezone;
      const data = savedAnalytics(snapshot, period, today, zone);
      if (data)
        put(
          `/api/read/analytics?${new URLSearchParams({ ...period, timezone: zone })}`,
          data,
          'partial',
        );
    }
    if (controller.getSnapshot().status !== 'ready' || !navigator.onLine)
      return;
    // A new save timestamp alone must not make warming read its own outputs
    // forever through source-loaded -> save -> warm. Only changed view inputs
    // or a new authorized scope need another pass.
    const scope = snapshotWarmKey(snapshot);
    if (warming === scope) return;
    warming = scope;
    // Persist the same safe DTOs used by ordinary views, including unopened detail routes.
    const keys = [
      ...(snapshot.role === 'OWNER' ? ['/api/read/settings'] : []),
      `/api/workouts?ownerId=${encodeURIComponent(ownerId)}`,
      `/api/workouts/transformmate/exercises?${new URLSearchParams({ ownerId, offset: '0', limit: '50' })}`,
      ...snapshot.workoutDates.map(
        (date) =>
          `/api/workouts/transformmate?${new URLSearchParams({ ownerId, from: date, to: date, limit: '20' })}`,
      ),
      ...[
        ...snapshot.plannedWorkouts,
        ...snapshot.workoutSessions,
        ...snapshot.nativeTrainings,
        ...snapshot.transformMateFacts,
      ].map(
        (item) =>
          `/api/read/workout?${new URLSearchParams({ path: item.href, date: item.date })}`,
      ),
    ];
    // Bounded background work; it never owns visible loading or navigation.
    let next = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (
          active &&
          next < keys.length &&
          controller.getSnapshot().bundle?.fence.deviceEpoch ===
            bundle.fence.deviceEpoch
        ) {
          const key = keys[next++];
          if (!key) break;
          await refreshClientRead(
            canonicalReadKey(new URL(key, location.origin)),
          ).catch(() => {});
        }
      }),
    );
  };
  const update = () => {
    void project().catch(() => {});
  };
  const stop = controller.subscribe(update);
  const stopContext = clientReads.subscribe('/api/read/context', update);
  window.addEventListener('popstate', update);
  window.addEventListener('tempo:read-location-change', update);
  update();
  return () => {
    active = false;
    stop();
    stopContext();
    window.removeEventListener('popstate', update);
    window.removeEventListener('tempo:read-location-change', update);
  };
}

/** Existing report renderer keeps its form mounted; this adapter supplies available local inputs. */
export function useReportReadModel() {
  const online = useReadOnline();
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  return useMemo(() => {
    if (online || !state.bundle) return {};
    const snapshot = state.bundle.snapshot;
    return {
      offlineDays: snapshot.diary.flatMap((day) => {
        const value = savedDiaryDay(snapshot, day.date);
        return value ? [value] : [];
      }),
      offlineSteps: snapshot.dailySteps,
      offlineStepsGoal: snapshot.views.summary?.dailyStepsGoal ?? null,
      offlinePhotos: snapshot.photos.items.map((photo) => ({
        id: photo.id,
        date: photo.date,
        daytime: photo.daytime,
        source: photo.source,
        observedAt: photo.observedAt,
        bytes: state.photos.find((row) => row.id === photo.id)?.bytes ?? null,
      })),
    };
  }, [online, state.bundle, state.photos]);
}

export function snapshotWarmKey(snapshot: OfflineSnapshot) {
  return JSON.stringify([
    snapshot.partition,
    snapshot.connectionGeneration,
    snapshot.to,
    snapshot.plannedWorkouts,
    snapshot.workoutSessions,
    snapshot.nativeTrainings,
    snapshot.transformMateFacts,
    snapshot.views.settings,
    snapshot.views.summary?.dailyStepsGoal,
    snapshot.views.catalog,
  ]);
}
