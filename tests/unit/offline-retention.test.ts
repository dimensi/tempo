import { describe, expect, it } from 'vitest';
import {
  mergeOfflineSnapshots,
  offlineLocalWindow,
  pruneOfflineSnapshot,
} from '@/contracts/offline-retention';
import { offlineFixture } from '../offline/fixtures';

describe('offline local calendar retention', () => {
  it('uses local dates across UTC midnight and DST rather than 15×24 hours', () => {
    const now = Date.parse('2026-03-08T04:30:00Z');
    expect(offlineLocalWindow(now, 'America/New_York')).toEqual({
      from: '2026-02-21',
      to: '2026-03-07',
    });
    expect(offlineLocalWindow(now, 'Asia/Tokyo')).toEqual({
      from: '2026-02-22',
      to: '2026-03-08',
    });
    expect(
      offlineLocalWindow(
        Date.parse('2026-03-09T04:30:00Z'),
        'America/New_York',
      ),
    ).toEqual({ from: '2026-02-23', to: '2026-03-09' });
    expect(
      offlineLocalWindow(
        Date.parse('2026-11-01T05:30:00Z'),
        'America/New_York',
      ),
    ).toEqual({ from: '2026-10-18', to: '2026-11-01' });
    expect(
      offlineLocalWindow(
        Date.parse('2026-11-01T06:30:00Z'),
        'America/New_York',
      ),
    ).toEqual({ from: '2026-10-18', to: '2026-11-01' });
  });
  it('prunes all dated details inclusively without changing genuine server metadata or zero/null', () => {
    const snapshot = offlineFixture(Date.parse('2026-10-12T12:00:00Z'));
    const dates = ['2026-09-27', '2026-09-28', '2026-10-12', '2026-10-13'];
    snapshot.diary = dates.map((date) => ({ ...snapshot.diary[0]!, date }));
    snapshot.photos.items = dates.map((date, i) => ({
      id: String(i).repeat(43),
      date,
      daytime: 'breakfast',
      source: 'manual',
      observedAt: snapshot.serverNow,
      mime: 'image/png',
      downloadUrl: `/api/offline/photos/${String(i).repeat(43)}?date=${date}`,
    }));
    snapshot.measurements = dates.map((measuredAt) => ({
      ...snapshot.measurements[0]!,
      measuredAt,
    }));
    snapshot.importedWeights = dates.map((measuredDate) => ({
      ...snapshot.importedWeights[0]!,
      measuredDate,
    }));
    snapshot.dailySteps = dates.map((date) => ({
      ...snapshot.dailySteps[0]!,
      date,
    }));
    snapshot.plannedWorkouts = dates.map((date) => ({
      ...snapshot.plannedWorkouts[0]!,
      date,
    }));
    snapshot.workoutSessions = dates.map((date) => ({
      ...snapshot.workoutSessions[0]!,
      date,
    }));
    snapshot.nativeTrainings = dates.map((date) => ({
      ...snapshot.nativeTrainings[0]!,
      date,
    }));
    snapshot.transformMateFacts = dates.map((date) => ({
      ...snapshot.transformMateFacts[0]!,
      date,
    }));
    const result = pruneOfflineSnapshot(snapshot, {
      from: '2026-09-28',
      to: '2026-10-12',
    });
    for (const collection of [
      result.diary,
      result.photos.items,
      result.dailySteps,
    ])
      expect(collection.map((r) => r.date)).toEqual([
        '2026-09-28',
        '2026-10-12',
      ]);
    expect(result.measurements.map((r) => r.measuredAt)).toEqual([
      '2026-09-28',
      '2026-10-12',
    ]);
    expect(result.importedWeights.map((r) => r.measuredDate)).toEqual([
      '2026-09-28',
      '2026-10-12',
    ]);
    for (const collection of [
      result.plannedWorkouts,
      result.workoutSessions,
      result.transformMateFacts,
      result.nativeTrainings,
    ])
      expect(collection.map((item) => item.date)).toEqual([
        '2026-09-28',
        '2026-10-12',
      ]);
    expect(result.dailySteps[0]!.steps).toBe(0);
    expect(result.importedWeights[0]!.rawValue).toBeNull();
    expect(result.expiresAt).toBe(snapshot.expiresAt);
    expect(result.sessionExpiresAt).toBe(snapshot.sessionExpiresAt);
  });
});

it('removes expired workout details across diary refresh and never crosses an account generation', () => {
  const old = offlineFixture(Date.parse('2026-09-01T12:00:00Z'));
  const fresh = offlineFixture(Date.parse('2026-10-12T12:00:00Z'));
  old.workoutSessions[0]!.href = '/workouts/sessions/old-visited';
  const merged = pruneOfflineSnapshot(
    mergeOfflineSnapshots(old, fresh),
    offlineLocalWindow(Date.parse(fresh.serverNow), 'UTC'),
  );
  expect(merged.diary.map((item) => item.date)).toEqual(['2026-10-12']);
  expect(merged.workoutSessions.map((item) => item.href)).not.toContain(
    '/workouts/sessions/old-visited',
  );
  expect(merged.workoutDates).not.toContain('2026-09-01');
  fresh.connectionGeneration = 'Z'.repeat(43);
  expect(
    mergeOfflineSnapshots(old, fresh).workoutSessions.map((item) => item.href),
  ).not.toContain('/workouts/sessions/old-visited');
});

it('quota eviction invalidates populated date coverage while preserving truly loaded empty dates', () => {
  const previous = offlineFixture(Date.parse('2026-09-01T12:00:00Z'));
  const fresh = offlineFixture(Date.parse('2026-10-12T12:00:00Z'));
  previous.workoutDates = ['2026-09-01', '2026-09-02'];
  previous.workoutSessions = Array.from({ length: 300 }, (_, index) => ({
    ...previous.workoutSessions[0]!,
    href: `/workouts/sessions/old-${index}`,
  }));
  const merged = mergeOfflineSnapshots(previous, fresh);
  expect(merged.workoutSessions).toHaveLength(300);
  expect(
    merged.workoutSessions.some(
      (item) => item.href === '/workouts/sessions/old-0',
    ),
  ).toBe(false);
  expect(
    merged.workoutSessions.some((item) => item.date === '2026-09-01'),
  ).toBe(true);
  expect(merged.workoutDates).not.toContain('2026-09-01'); // Remaining records are a partial date.
  expect(merged.workoutDates).toContain('2026-09-02'); // Confirmed empty is still distinct from unknown.
  expect(merged.workoutDates).toContain('2026-10-12');
});
