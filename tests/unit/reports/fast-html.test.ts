import { expect, it, vi } from 'vitest';
import { syntheticDay } from './fixtures';
const launch = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('Browser unavailable');
  }),
);
vi.mock('server-only', () => ({}));
vi.mock('@playwright/test', () => ({ chromium: { launch } }));
import { generateReport } from '@/server/pdf/service';
import type { ReportDataSource } from '@/server/pdf/source';

const request = {
  contractVersion: 1 as const,
  ownerId: 'synthetic-owner',
  start: '2026-10-10',
  end: '2026-10-10',
  period: 'daily' as const,
  format: 'html' as const,
};
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

it('returns escaped long HTML with an authorized real photo without launching Chromium or producing PDF', async () => {
  const day = syntheticDay(undefined, 300);
  day.meals[0]!.entries[0]!.name = '<script>synthetic</script>';
  const readPhoto = vi.fn(async () => ({
    bytes: png,
    mime: 'image/png' as const,
  }));
  const source: ReportDataSource = {
    getSteps: async () => [],
    getNutritionDays: async () => [day],
    listPhotos: async () => [
      {
        id: 'synthetic-photo',
        date: request.start,
        daytime: 'breakfast',
        source: 'manual',
        observedAt: '2026-10-11T00:00:00Z',
      },
    ],
    readPhoto,
  };
  const html = await generateReport(
    source,
    request,
    new AbortController().signal,
  );
  expect(typeof html).toBe('string');
  expect(launch).not.toHaveBeenCalled();
  expect(readPhoto).toHaveBeenCalledWith(
    request.ownerId,
    'synthetic-photo',
    expect.any(AbortSignal),
  );
  expect(html).toContain('data:image/png;base64,' + png.toString('base64'));
  expect(html).toContain('&lt;script&gt;synthetic&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('Яйцо · запись 300');
  expect(html).toContain('10 октября 2026');
  expect(html).toContain('class="report-preview"');
  expect(html).not.toContain('id="report-pages"');
  expect(html).not.toContain('data-report-ready');
  expect(html).toContain('img-src data:');
  await expect(
    generateReport(
      source,
      { ...request, format: 'pdf' },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'RUNTIME' });
  expect(launch).toHaveBeenCalledOnce();
});

it('keeps one real empty state without artificial meal rows and checks HTML cancellation', async () => {
  const day = syntheticDay(undefined, 0);
  const zero = { calories: '0', protein: null, fat: '-0e+10', carbs: '0' };
  for (const meal of day.meals) {
    meal.totals = { ...zero };
    meal.knownTotals = { ...zero };
    meal.officialTotals = { ...zero };
  }
  const source: ReportDataSource = {
    getSteps: async () => [],
    getNutritionDays: async () => [day],
    listPhotos: async () => [],
    readPhoto: async () => {
      throw new Error('No photo');
    },
  };
  const html = await generateReport(
    source,
    request,
    new AbortController().signal,
  );
  expect(html).toContain('<p class="empty">Нет записей</p>');
  expect(html).not.toContain('class="meal-block"');
  expect(html).not.toContain('class="table-header"');
  const controller = new AbortController();
  const cancelling: ReportDataSource = {
    ...source,
    getSteps: async () => [],
    getNutritionDays: async () => {
      controller.abort();
      return [day];
    },
  };
  await expect(
    generateReport(cancelling, request, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
