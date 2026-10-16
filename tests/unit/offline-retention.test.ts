import { offlineLocalWindow } from '@/contracts/offline-retention';
import { describe, expect, it } from 'vitest';

describe('offline local calendar retention', () => {
  it('uses local dates across UTC midnight and DST rather than 15×24 hours', () => {
    const now = Date.parse('2026-03-08T04:30:00Z');
    expect(offlineLocalWindow(now, 'America/New_York')).toEqual({
      from: '2026-02-21',
      to: '2026-03-07',
    });
    expect(offlineLocalWindow(now, 'Asia/Tokyo')).toEqual({
      from: '2026-02-22',
      to: '2026-03-08',
    });
    expect(
      offlineLocalWindow(
        Date.parse('2026-03-09T04:30:00Z'),
        'America/New_York',
      ),
    ).toEqual({ from: '2026-02-23', to: '2026-03-09' });
    expect(
      offlineLocalWindow(
        Date.parse('2026-11-01T05:30:00Z'),
        'America/New_York',
      ),
    ).toEqual({ from: '2026-10-18', to: '2026-11-01' });
    expect(
      offlineLocalWindow(
        Date.parse('2026-11-01T06:30:00Z'),
        'America/New_York',
      ),
    ).toEqual({ from: '2026-10-18', to: '2026-11-01' });
  });
});
