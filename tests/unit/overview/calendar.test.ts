import { describe, expect, it } from 'vitest';
import { dateInTimezone, shiftDate } from '@/contracts/nutrition-sync-dates';
import { nextMidnightDelay } from '@/features/overview/calendar';
describe('overview calendar windows', () => {
  it('uses the local date on both sides of UTC midnight', () => {
    const now = new Date('2026-10-12T00:30:00Z');
    expect(dateInTimezone(now, 'America/Los_Angeles')).toBe('2026-10-11');
    expect(dateInTimezone(now, 'Pacific/Kiritimati')).toBe('2026-10-12');
    expect(shiftDate('2026-03-10', -6)).toBe('2026-03-04');
  });
  it('keeps calendar windows consecutive across DST', () => {
    expect(
      dateInTimezone(new Date('2026-03-08T07:30:00Z'), 'America/New_York'),
    ).toBe('2026-03-08');
    expect(
      dateInTimezone(new Date('2026-11-01T06:30:00Z'), 'America/New_York'),
    ).toBe('2026-11-01');
    const date = new Date(2026, 9, 12, 23, 59, 59, 999);
    expect(nextMidnightDelay(date)).toBe(51);
  });
});

it('schedules the next local midnight across 23 and 25 hour DST days', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    expect(nextMidnightDelay(new Date(2026, 2, 8))).toBe(
      23 * 60 * 60 * 1000 + 50,
    );
    expect(nextMidnightDelay(new Date(2026, 10, 1))).toBe(
      25 * 60 * 60 * 1000 + 50,
    );
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
