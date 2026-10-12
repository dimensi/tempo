import { dateInTimezone } from '@/contracts/nutrition-sync-dates';
export function localCalendar(now = new Date()) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { today: dateInTimezone(now, timezone), timezone };
}
export function nextMidnightDelay(now = new Date()) {
  return (
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() -
    now.getTime() +
    50
  );
}
