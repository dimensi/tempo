import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { summarizeSteps, stepsProgress } from '@/lib/reports/steps';
import { renderReportHtml } from '@/lib/reports/template';
import { syntheticDay } from './fixtures';

it('keeps zero and gaps distinct, excludes missing dates from the average and sums safely', () => {
  expect(
    summarizeSteps([
      { date: '2026-10-10', steps: 0, source: 'YAZIO' },
      { date: '2026-10-11', steps: null, source: null },
      { date: '2026-10-12', steps: 10001, source: 'YAZIO' },
    ]),
  ).toEqual({ observedDays: 2, average: '5000.5' });
  expect(summarizeSteps([])).toEqual({ observedDays: 0, average: null });
  expect(
    summarizeSteps(
      Array.from({ length: 31 }, (_, i) => ({
        date: String(i),
        steps: Number.MAX_SAFE_INTEGER,
        source: 'YAZIO' as const,
      })),
    ).average,
  ).toBe(String(Number.MAX_SAFE_INTEGER));
});
it('does not invent progress and caps only the visual width', () => {
  expect(stepsProgress('0', 10000)).toEqual({ percent: '0', width: 0 });
  expect(stepsProgress('7500', 10000)).toEqual({ percent: '75', width: 75 });
  expect(stepsProgress('10000', 10000)).toEqual({ percent: '100', width: 100 });
  expect(stepsProgress('12345', 10000)).toEqual({ percent: '123', width: 100 });
  expect(stepsProgress(null, 10000)).toBeNull();
  expect(stepsProgress('12345', null)).toBeNull();
});
it('puts steps before energy; renders goal and coverage only when applicable', () => {
  const request = {
    contractVersion: 1 as const,
    ownerId: 'owner',
    start: '2026-10-10',
    end: '2026-10-12',
    period: 'custom' as const,
    format: 'html' as const,
  };
  const data = {
    days: [syntheticDay()],
    photos: [],
    steps: [
      { date: '2026-10-10', steps: 12345, source: 'YAZIO' as const },
      { date: '2026-10-11', steps: 0, source: 'YAZIO' as const },
    ],
    dailyStepsGoal: null as number | null,
  };
  const html = renderReportHtml(request, data);
  expect(html.indexOf('steps-column')).toBeLessThan(
    html.indexOf('data-nutrient="calories"'),
  );
  expect(html).toContain('Данных за 2 из 3 дней');
  expect(html).not.toContain('Текущая цель:');
  expect(html).not.toContain('class="steps-track"');
  data.dailyStepsGoal = 10000;
  const goalHtml = renderReportHtml(request, data);
  expect(goalHtml).toContain('Текущая цель:');
  expect(goalHtml).toContain('123% от цели');
  expect(goalHtml).toContain('0% от цели');
  expect(goalHtml.match(/class="steps-track"/g)).toHaveLength(3);
});
