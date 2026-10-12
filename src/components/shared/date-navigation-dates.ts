import { shiftDate } from '@/contracts/nutrition-sync-dates';

export function weekDates(date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const monday = shiftDate(date, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
}

export function browserToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
