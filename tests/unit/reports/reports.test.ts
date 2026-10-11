import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { reportRequestSchema, periodDates } from '@/contracts/reports';
import { summarizeDays } from '@/server/pdf/summary';
import { renderReportHtml } from '@/server/pdf/template';
import { loadReportDataset, withReportSlot } from '@/server/pdf/service';
import type { ReportDataSource } from '@/server/pdf/source';
import { syntheticDay } from './fixtures';
const request = {
  contractVersion: 1 as const,
  ownerId: 'owner',
  start: '2026-10-10',
  end: '2026-10-10',
  period: 'daily' as const,
  format: 'html' as const,
};
const signal = new AbortController().signal;
function source(days = [syntheticDay()]): ReportDataSource {
  return {
    getNutritionDays: async () => days,
    listPhotos: async () => [],
    readPhoto: async () => {
      throw new Error('Unexpected photo');
    },
  };
}
describe('report rules', () => {
  it('validates inclusive periods across leap dates, reversed/oversized and daily/weekly constraints', () => {
    expect(periodDates('2024-02-28', '2024-03-01')).toEqual([
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ]);
    for (const override of [
      { end: '2026-10-09' },
      { end: '2026-11-10' },
      { period: 'weekly' },
      { start: '2026-02-30' },
    ])
      expect(
        reportRequestSchema.safeParse({ ...request, ...override }).success,
      ).toBe(false);
    expect(
      reportRequestSchema.safeParse({
        ...request,
        period: 'weekly',
        end: '2026-10-16',
      }).success,
    ).toBe(true);
  });
  it('sums authoritative daily decimals exactly, never substitutes entry/official totals or missing days', () => {
    const days = [syntheticDay(), syntheticDay('2026-10-11')];
    expect(summarizeDays(days, 2).totals.calories).toBe('0.2');
    expect(summarizeDays(days, 2).totals.fat).toBeNull();
    expect(summarizeDays(days, 2).knownTotals.fat).toBe('27.3056');
    expect(summarizeDays(days, 3).totals.calories).toBeNull();
  });
  it('escapes upstream markup, explicitly marks missing/unknown/partial values and keeps original entry decimals', () => {
    const day = syntheticDay();
    day.meals[0]!.entries[0]!.name =
      '<img src="https://evil.test" onerror="alert(1)">';
    const html = renderReportHtml(
      { ...request, period: 'custom', end: '2026-10-11' },
      { days: [day], photos: [] },
      new Uint8Array(),
    );
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src="https:');
    for (const text of [
      'Неизвестно',
      'Известная часть',
      'Нет данных за этот день',
      '180.32',
      '12.5212',
    ])
      expect(html).toContain(text);
  });
  it('fails no-data, duplicate/out-of-scope days and excessive entry/string/decimal budgets', async () => {
    await expect(
      loadReportDataset(source([]), request, signal),
    ).rejects.toMatchObject({ code: 'NO_DATA' });
    await expect(
      loadReportDataset(source([syntheticDay('2026-10-11')]), request, signal),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      loadReportDataset(
        source([syntheticDay(undefined, 3001)]),
        request,
        signal,
      ),
    ).rejects.toMatchObject({ code: 'OVERSIZED' });
    const day = syntheticDay();
    day.totals = { ...day.totals, calories: '1e999' };
    await expect(
      loadReportDataset(source([day]), request, signal),
    ).rejects.toMatchObject({ code: 'OVERSIZED' });
  });
  it('rejects remote/SVG photo payloads and reads private bytes by authorized owner/id', async () => {
    const adapter = source();
    adapter.listPhotos = async () => [
      {
        id: 'photo',
        date: request.start,
        daytime: 'breakfast',
        source: 'manual',
        observedAt: '2026-10-11T00:00:00Z',
      },
    ];
    adapter.readPhoto = vi.fn(async () => ({
      bytes: Buffer.from('<svg/>'),
      mime: 'image/png' as const,
    }));
    await expect(
      loadReportDataset(adapter, request, signal),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect(adapter.readPhoto).toHaveBeenCalledWith('owner', 'photo', signal);
  });
  it('bounds concurrent preview/PDF requests and releases the slot on errors', async () => {
    let release!: () => void;
    const first = withReportSlot(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await expect(withReportSlot(async () => {})).rejects.toMatchObject({
      code: 'BUSY',
    });
    release();
    await first;
    await expect(
      withReportSlot(async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
    expect(await withReportSlot(async () => 1)).toBe(1);
  });
});
