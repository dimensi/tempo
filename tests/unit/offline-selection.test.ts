import { expect, it } from 'vitest';
import { offlineFixture } from '../offline/fixtures';
import { offlineSnapshotSchema } from '@/contracts/offline';
import {
  savedAnalytics,
  savedDiaryDay,
  savedMeasurements,
  savedOverview,
} from '@/app/offline-model';
import { pruneOfflineSnapshot } from '@/contracts/offline-retention';
function fixture() {
  const snapshot = offlineFixture(Date.parse('2026-10-12T12:00:00Z'));
  const day = snapshot.diary[0]!;
  snapshot.views.summary = {
    from: '2025-10-12',
    to: '2026-10-12',
    workouts: {
      planned: { title: 'Next', date: '2026-10-20' },
      completed: null,
    },
    latestWeight: { date: '2026-09-01', value: '72' },
    nutrition: [
      {
        date: day.date,
        fetchedAt: day.fetchedAt,
        totals: day.totals,
        knownTotals: day.knownTotals,
        hasEntries: true,
      },
    ],
    body: snapshot.measurements.map((row) => ({
      id: row.key,
      measuredAt: row.measuredAt,
      values: row.values,
    })),
    bodyComplete: true,
    weight: {
      range: { from: '2025-10-12', to: '2026-10-12' },
      local: [],
      imported: [],
    },
    steps: snapshot.dailySteps.map(({ date, steps, observedAt }) => ({
      date,
      steps,
      observedAt,
    })),
  };
  return snapshot;
}
it('unknown objects stay unknown and adapters preserve exact values', () => {
  const snapshot = fixture();
  expect(savedDiaryDay(snapshot, '2026-10-11')).toBeNull();
  const day = savedDiaryDay(snapshot, '2026-10-12')!;
  expect(day.totals).toEqual(snapshot.diary[0]!.totals);
  expect(day.meals[0]!.entries[0]!.sourceId).toBeNull();
  expect(savedMeasurements(snapshot)[0]!.values[0]!.value).toBe('72.125');
  expect(
    savedAnalytics(
      { ...snapshot, views: { ...snapshot.views, summary: null } },
      { from: '2026-10-11', to: '2026-10-12' },
      '2026-10-12',
      'UTC',
    ),
  ).toBeNull();
});
it('partial analytics preserve genuine zero, unknown days and empty diaries separately', () => {
  const snapshot = fixture();
  const summary = snapshot.views.summary!;
  summary.nutrition.push({
    ...summary.nutrition[0]!,
    date: '2026-10-10',
    hasEntries: false,
  });
  const data = savedAnalytics(
    snapshot,
    { from: '2026-10-10', to: '2026-10-12' },
    '2026-10-12',
    'UTC',
  )!;
  expect(data.canSync).toBe(false);
  expect(data.nutrition.state).toBe('ready');
  if (data.nutrition.state !== 'ready' || data.activity.state !== 'ready')
    throw Error('Expected saved blocks');
  expect(data.nutrition.data.days.map((day) => day.quality)).toEqual([
    'empty',
    'missing',
    'partial',
  ]);
  expect(data.nutrition.data.days[1]!.totals.calories).toBeNull();
  expect(data.nutrition.data.calorieMean).toBe('0');
  expect(data.activity.data.summary.observedDays).toBe(1);
  expect(data.activity.data.summary.totalSteps).toBe('0');
  expect(data.activity.data.summary.days[1]!.steps).toBeNull();
});
it('never compares uncovered periods or loses compact summaries when details age out', () => {
  const snapshot = fixture();
  const data = savedAnalytics(
    snapshot,
    { from: '2025-10-12', to: '2025-10-15' },
    '2026-10-12',
    'UTC',
  )!;
  expect(data.nutrition).toMatchObject({
    comparison: null,
    comparisonUnavailable: true,
  });
  const pruned = pruneOfflineSnapshot(snapshot, {
    from: '2026-10-13',
    to: '2026-10-27',
  });
  expect(pruned.diary).toEqual([]);
  expect(pruned.workoutSessions).toEqual([]);
  expect(pruned.views.summary).toEqual(snapshot.views.summary);
  const overview = savedOverview(pruned, '2026-10-12', 'UTC')!;
  expect(overview.workouts.planned?.date).toBe('2026-10-20');
  expect(overview.weight.latest).toEqual({ date: '2026-09-01', value: '72' });
});
it('the strict view DTO refuses credentials, signed file URLs and obsolete contracts', () => {
  const snapshot = fixture();
  expect(offlineSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(
    offlineSnapshotSchema.safeParse({ ...snapshot, contractVersion: 1 })
      .success,
  ).toBe(false);
  expect(
    offlineSnapshotSchema.safeParse({
      ...snapshot,
      views: { ...snapshot.views, token: 'secret' },
    }).success,
  ).toBe(false);
  expect(
    offlineSnapshotSchema.safeParse({
      ...snapshot,
      views: {
        ...snapshot.views,
        videos: [
          {
            id: 'v',
            sessionHref: '/workouts/sessions/a',
            size: 20,
            href: 'https://cdn.test/file?token=secret',
          },
        ],
      },
    }).success,
  ).toBe(false);
});
