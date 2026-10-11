import { describe, expect, it } from 'vitest';
import { resolveSyncPeriod } from '@/contracts/nutrition-sync';
import { dateInTimezone } from '@/contracts/nutrition-sync-dates';

describe('inclusive calendar ranges in user timezone', () => {
  const now = new Date('2026-10-11T21:30:00Z');
  it('defaults end to local today and retains UTC compatibility', () => {
    expect(
      resolveSyncPeriod(
        { mode: 'period', from: '2026-10-06', timezone: 'Europe/Moscow' },
        now,
      ),
    ).toEqual({ from: '2026-10-06', to: '2026-10-12' });
    expect(
      resolveSyncPeriod({ mode: 'period', from: '2026-10-06' }, now).to,
    ).toBe('2026-10-11');
    expect(
      resolveSyncPeriod(
        {
          mode: 'recent',
          days: 7,
          through: '2026-10-12',
          timezone: 'Europe/Moscow',
        },
        now,
      ),
    ).toEqual({ from: '2026-10-06', to: '2026-10-12' });
    expect(dateInTimezone(now, 'America/Los_Angeles')).toBe('2026-10-11');
  });
  it('handles DST calendar arithmetic and leap day', () => {
    expect(
      resolveSyncPeriod(
        {
          mode: 'recent',
          days: 7,
          through: '2026-03-08',
          timezone: 'America/New_York',
        },
        new Date('2026-03-08T12:00:00Z'),
      ),
    ).toEqual({ from: '2026-03-02', to: '2026-03-08' });
    expect(
      resolveSyncPeriod(
        { mode: 'recent', days: 3, through: '2024-03-01' },
        new Date('2024-03-01T12:00:00Z'),
      ),
    ).toEqual({ from: '2024-02-28', to: '2024-03-01' });
  });
  it.each([
    { mode: 'period', from: '2026-10-13', timezone: 'Europe/Moscow' },
    {
      mode: 'period',
      from: '2026-10-01',
      to: '2026-10-13',
      timezone: 'Europe/Moscow',
    },
    { mode: 'recent', days: 7, through: '2026-10-12' },
    { mode: 'period', from: '2026-10-12', to: '2026-10-11' },
    { mode: 'period', from: '2025-01-01' },
    { mode: 'recent', days: 32, through: '2026-10-11' },
    { mode: 'period', from: '2026-02-29' },
    { mode: 'period', from: '2026-10-01', timezone: 'Invalid/Zone' },
    { mode: 'period', from: '2026-10-01', timezone: 'x'.repeat(101) },
  ])('rejects invalid/future/reversed/oversized request %j', (request) => {
    expect(() => resolveSyncPeriod(request, now)).toThrow();
  });
  it('rejects offset strings as non-IANA zones', () => {
    expect(() =>
      resolveSyncPeriod(
        { mode: 'period', from: '2026-10-01', timezone: '+03:00' },
        now,
      ),
    ).toThrow();
  });
  it('accepts exactly 366 days and rejects 367', () => {
    const clock = new Date('2024-12-31T23:00:00Z');
    expect(
      resolveSyncPeriod({ mode: 'period', from: '2024-01-01' }, clock).to,
    ).toBe('2024-12-31');
    expect(() =>
      resolveSyncPeriod({ mode: 'period', from: '2023-12-31' }, clock),
    ).toThrow();
  });
});
