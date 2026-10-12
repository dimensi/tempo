import { describe, expect, it } from 'vitest';
import { weekDates } from '@/components/shared/date-navigation-dates';

describe('calendar week navigation', () => {
  it('keeps Monday to Sunday across the year boundary', () => {
    expect(weekDates('2027-01-01')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });
  it('includes leap day and treats Sunday as the last day', () => {
    expect(weekDates('2024-03-03')).toContain('2024-02-29');
    expect(weekDates('2024-03-03')[6]).toBe('2024-03-03');
  });
  it('does not lose calendar days across DST transitions', () => {
    expect(weekDates('2026-03-29')).toEqual([
      '2026-03-23',
      '2026-03-24',
      '2026-03-25',
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
    ]);
    expect(weekDates('2026-10-25')[6]).toBe('2026-10-25');
  });
});
