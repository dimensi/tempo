import { it, expect } from 'vitest';
import {
  measurementsInRange,
  bodyChart,
} from '@/features/analytics/measurements';
import type { Measurement } from '@/contracts/measurements';
it('filters inclusive dates and preserves decimal measurements without converting units', () => {
  const record = (id: string, measuredAt: string): Measurement => ({
    id,
    ownerId: 'synthetic',
    sync: [],
    measuredAt,
    note: null,
    values: [{ metric: 'weight', value: '80.125', unit: 'kg' }],
  });
  const data = measurementsInRange({ from: '2026-10-01', to: '2026-10-03' }, [
    record('end', '2026-10-03'),
    record('outside', '2026-09-30'),
    record('start', '2026-10-01'),
  ]);
  expect(data.map((item) => item.id)).toEqual(['start', 'end']);
  expect(data[0]!.values[0]!.value).toBe('80.125');
});

it('keeps each source observation and breaks chart lines across long gaps', () => {
  const chart = bodyChart([
    { id: 'a', date: '2026-10-01', value: '110.1', source: 'LOCAL' },
    { id: 'b', date: '2026-10-01', value: '110.2', source: 'LOCAL' },
    { id: 'c', date: '2026-10-01', value: '110.3', source: 'YAZIO' },
    { id: 'd', date: '2026-10-14', value: '108.6', source: 'YAZIO' },
  ]);
  expect(
    chart.map((point) => ({
      date: point.date,
      local: point.local,
      yazio: point.yazio,
    })),
  ).toEqual([
    { date: '2026-10-01', local: 110.1, yazio: 110.3 },
    { date: '2026-10-01', local: 110.2, yazio: null },
    { date: '2026-10-02', local: null, yazio: null },
    { date: '2026-10-14', local: null, yazio: 108.6 },
  ]);
  expect(chart.map((point) => point.time)).toEqual(
    chart.map((point) => Date.parse(point.date)),
  );
});
