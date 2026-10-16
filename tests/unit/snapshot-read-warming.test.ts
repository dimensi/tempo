import { expect, it } from 'vitest';
import { snapshotWarmKey } from '@/app/snapshot-reads';
import { offlineFixture } from '../offline/fixtures';
it('snapshot warming ignores save timestamps but observes changed settings and workout inputs', () => {
  const snapshot = offlineFixture(Date.now());
  snapshot.views.summary = {
    from: snapshot.from,
    to: snapshot.to,
    dailyStepsGoal: 10000,
    workouts: { planned: null, completed: null },
    latestWeight: null,
    nutrition: [],
    body: [],
    bodyComplete: true,
    weight: {
      range: { from: snapshot.from, to: snapshot.to },
      local: [],
      imported: [],
    },
    steps: [],
  };
  const later = structuredClone(snapshot);
  later.serverNow = new Date(Date.now() + 1000).toISOString();
  expect(snapshotWarmKey(later)).toBe(snapshotWarmKey(snapshot));
  later.views.summary!.dailyStepsGoal = 12345;
  expect(snapshotWarmKey(later)).not.toBe(snapshotWarmKey(snapshot));
  const changed = structuredClone(snapshot);
  changed.workoutSessions[0]!.note = 'Changed actual result';
  expect(snapshotWarmKey(changed)).not.toBe(snapshotWarmKey(snapshot));
});
