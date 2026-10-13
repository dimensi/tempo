import { dateInTimezone, shiftDate } from './nutrition-sync-dates';
import type { OfflineSnapshot } from './offline';
export const offlineRetentionDays = 15;
export function offlineLocalWindow(now: number, timezone: string) {
  const to = dateInTimezone(new Date(now), timezone);
  return { from: shiftDate(to, -(offlineRetentionDays - 1)), to };
}
export function pruneOfflineSnapshot(
  snapshot: OfflineSnapshot,
  window: { from: string; to: string },
): OfflineSnapshot {
  const within = (date: string) => date >= window.from && date <= window.to;
  return {
    ...snapshot,
    ...window,
    diary: snapshot.diary.filter((day) => within(day.date)),
    photos: {
      ...snapshot.photos,
      items: snapshot.photos.items.filter((photo) => within(photo.date)),
    },
    measurements: snapshot.measurements.filter((record) =>
      within(record.measuredAt),
    ),
    importedWeights: snapshot.importedWeights.filter((record) =>
      within(record.measuredDate),
    ),
    dailySteps: snapshot.dailySteps.filter((day) => within(day.date)),
    // Workout copies are bounded by collection/payload quotas, not diary age.
    plannedWorkouts: snapshot.plannedWorkouts,
    workoutSessions: snapshot.workoutSessions,
    nativeTrainings: snapshot.nativeTrainings,
    transformMateFacts: snapshot.transformMateFacts,
  };
}
export function mergeOfflineSnapshots(
  previous: OfflineSnapshot | undefined,
  incoming: OfflineSnapshot,
): OfflineSnapshot {
  if (
    !previous ||
    previous.partition !== incoming.partition ||
    previous.connectionGeneration !== incoming.connectionGeneration
  )
    return incoming;
  const evictedWorkoutDates = new Set<string>();
  const merge = <T extends { date: string }>(
    old: T[],
    fresh: T[],
    limit: number,
    key: (item: T) => string,
    evictedDates?: Set<string>,
  ) => {
    const values = new Map(
      old
        .filter((item) => item.date < incoming.from || item.date > incoming.to)
        .map((item) => [key(item), item]),
    );
    for (const item of fresh) values.set(key(item), item);
    const records = [...values.values()];
    for (const item of records.slice(0, Math.max(0, records.length - limit)))
      evictedDates?.add(item.date);
    return records.slice(-limit);
  };
  const plannedWorkouts = merge(
    previous.plannedWorkouts,
    incoming.plannedWorkouts,
    1000,
    (item) => item.href,
    evictedWorkoutDates,
  );
  const workoutSessions = merge(
    previous.workoutSessions,
    incoming.workoutSessions,
    300,
    (item) => item.href,
    evictedWorkoutDates,
  );
  const nativeTrainings = merge(
    previous.nativeTrainings,
    incoming.nativeTrainings,
    300,
    (item) => item.href,
    evictedWorkoutDates,
  );
  const transformMateFacts = merge(
    previous.transformMateFacts,
    incoming.transformMateFacts,
    300,
    (item) => item.href,
    evictedWorkoutDates,
  );
  return {
    ...incoming,
    diary: merge(previous.diary, incoming.diary, 30, (item) => item.date),
    photos: {
      ...incoming.photos,
      items: merge(
        previous.photos.items,
        incoming.photos.items,
        300,
        (item) => item.id,
      ),
    },
    measurements: [
      ...previous.measurements.filter(
        (item) =>
          item.measuredAt < incoming.from || item.measuredAt > incoming.to,
      ),
      ...incoming.measurements,
    ].slice(-1000),
    importedWeights: [
      ...previous.importedWeights.filter(
        (item) =>
          item.measuredDate < incoming.from || item.measuredDate > incoming.to,
      ),
      ...incoming.importedWeights,
    ].slice(-300),
    dailySteps: merge(
      previous.dailySteps,
      incoming.dailySteps,
      30,
      (item) => item.date,
    ),
    workoutDates: [
      ...new Set([...previous.workoutDates, ...incoming.workoutDates]),
    ]
      .slice(-300)
      .filter((date) => !evictedWorkoutDates.has(date)),
    plannedWorkouts,
    workoutSessions,
    nativeTrainings,
    transformMateFacts,
  };
}
