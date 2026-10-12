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
    plannedWorkouts: snapshot.plannedWorkouts.filter((record) =>
      within(record.date),
    ),
    workoutSessions: snapshot.workoutSessions.filter((record) =>
      within(record.date),
    ),
    transformMateFacts: snapshot.transformMateFacts.filter((record) =>
      within(record.date),
    ),
  };
}
