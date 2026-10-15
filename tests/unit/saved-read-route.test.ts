import { expect, it } from 'vitest';
import { offlineFixture } from '../offline/fixtures';
import { hasSavedReadRoute } from '@/lib/saved-read-route';

function saved(path: string) {
  const snapshot = offlineFixture(Date.parse('2026-10-12T12:00:00Z'));
  snapshot.views.summary = {
    dailyStepsGoal: null,
    from: '2025-10-12',
    to: '2026-10-12',
    workouts: { planned: null, completed: null },
    latestWeight: null,
    nutrition: [],
    body: [],
    bodyComplete: true,
    weight: {
      range: { from: '2025-10-12', to: '2026-10-12' },
      local: [],
      imported: [],
    },
    steps: [],
  };
  return hasSavedReadRoute(snapshot, new URL(path, 'https://tempo.test'));
}

it('recognizes only core routes whose requested data is already saved', () => {
  expect(saved('/')).toBe(true);
  expect(saved('/diary?date=2026-10-12')).toBe(true);
  expect(saved('/diary?date=2026-09-01')).toBe(false);
  expect(saved('/measurements')).toBe(true);
  expect(saved('/analytics?from=2026-10-01&to=2026-10-12&timezone=UTC')).toBe(
    true,
  );
  expect(saved('/analytics?from=2024-10-01&to=2024-10-12&timezone=UTC')).toBe(
    false,
  );
  expect(saved('/workouts?date=2026-10-12')).toBe(true);
  expect(saved('/workouts?date=2026-09-01')).toBe(false);
});

it('keeps mutation routes on the live path', () => {
  expect(saved('/workouts/new')).toBe(false);
  expect(saved('/workouts/plans/one/edit')).toBe(false);
  expect(saved('/workouts/sessions/one/edit')).toBe(false);
});
