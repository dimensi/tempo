import { z } from 'zod';
import { diaryDateSchema } from '@/contracts/nutrition';

export const timezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    if (/^[+-]/.test(value)) return false;
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid timezone');

export function dateInTimezone(now: Date, timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezoneSchema.parse(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function shiftDate(date: string, days: number) {
  return new Date(Date.parse(diaryDateSchema.parse(date)) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
