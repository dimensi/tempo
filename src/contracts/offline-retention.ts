import { dateInTimezone, shiftDate } from './nutrition-sync-dates';
export const offlineRetentionDays = 15;
export function offlineLocalWindow(now: number, timezone: string) {
  const to = dateInTimezone(new Date(now), timezone);
  return { from: shiftDate(to, -(offlineRetentionDays - 1)), to };
}
