import { afterEach, expect, it, vi } from 'vitest';
import { weeklyRange } from '@/features/reports/weekly-range';
afterEach(() => vi.unstubAllEnvs());
it.each([
  ['2026-01-29', '2026-02-04', '29 января 2026 г. — 4 февраля 2026 г.'],
  ['2026-12-29', '2027-01-04', '29 декабря 2026 г. — 4 января 2027 г.'],
  ['2026-03-06', '2026-03-12', '6 марта 2026 г. — 12 марта 2026 г.'],
  ['2026-10-30', '2026-11-05', '30 октября 2026 г. — 5 ноября 2026 г.'],
])(
  'shows seven inclusive calendar days from %s across month/year/DST boundaries',
  (start, end, label) => {
    for (const timezone of [
      'Europe/Moscow',
      'America/New_York',
      'Europe/Berlin',
    ]) {
      vi.stubEnv('TZ', timezone);
      expect(weeklyRange(start)).toEqual({ end, label });
    }
  },
);
it.each(['', 'invalid', '2026-02-30'])(
  'hides the range for missing or invalid date %s',
  (start) => {
    expect(weeklyRange(start)).toBeNull();
  },
);
