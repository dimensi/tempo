import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { reportRequestSchema, periodDates } from '@/contracts/reports';
import { summarizeDays } from '@/lib/reports/summary';
import { renderReportHtml } from '@/lib/reports/template';
import { loadReportDataset, withReportSlot } from '@/server/pdf/service';
import type { ReportDataSource } from '@/server/pdf/source';
import { syntheticDay } from './fixtures';
import { photoPixels } from '@/server/pdf/images';
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
    getStepsGoal: async () => null,
    getSteps: async () => [],
    getNutritionDays: async () => days,
    listPhotos: async () => [],
    readPhoto: async () => {
      throw new Error('Unexpected photo');
    },
  };
}
describe('report rules', () => {
  it('allows C-compatible 8 MiB files but keeps the 20 MiB total photo budget', async () => {
    const adapter = source();
    adapter.listPhotos = async () =>
      ['one', 'two', 'three'].map((id, index) => ({
        id,
        date: request.start,
        daytime: (['breakfast', 'lunch', 'dinner'] as const)[index]!,
        source: 'manual' as const,
        observedAt: '2026-10-11T00:00:00Z',
      }));
    const bytes = Buffer.alloc(8 * 1024 * 1024);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.write('IHDR', 12);
    bytes.writeUInt32BE(450, 16);
    bytes.writeUInt32BE(225, 20);
    adapter.readPhoto = vi.fn(async () => ({
      bytes,
      mime: 'image/png' as const,
    }));
    await expect(
      loadReportDataset(adapter, request, signal),
    ).rejects.toMatchObject({ code: 'OVERSIZED' });
    expect(adapter.readPhoto).toHaveBeenCalledTimes(3);
    adapter.listPhotos = async () => [
      {
        id: 'one',
        date: request.start,
        daytime: 'breakfast',
        source: 'manual',
        observedAt: '2026-10-11T00:00:00Z',
      },
    ];
    expect(
      (await loadReportDataset(adapter, request, signal)).photos,
    ).toHaveLength(1);
  });
  it('rejects raster decompression bombs before browser decoding', () => {
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.write('IHDR', 12);
    bytes.writeUInt32BE(450, 16);
    bytes.writeUInt32BE(225, 20);
    expect(photoPixels(bytes, 'image/png')).toBe(101250);
    bytes.writeUInt32BE(100000, 16);
    expect(() => photoPixels(bytes, 'image/png')).toThrow('OVERSIZED');
    expect(() => photoPixels(Buffer.from('<svg/>'), 'image/svg+xml')).toThrow(
      'INVALID',
    );
  });
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
  it('escapes upstream markup and marks missing/unknown/partial values with rounded display decimals', () => {
    const day = syntheticDay();
    day.meals[0]!.entries[0]!.name =
      '<img src="https://evil.test" onerror="alert(1)">';
    const html = renderReportHtml(
      { ...request, period: 'custom', end: '2026-10-11' },
      { dailyStepsGoal: null, steps: [], days: [day], photos: [] },
      {
        sans: new Uint8Array(),
        bold: new Uint8Array(),
        serif: new Uint8Array(),
      },
    );
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src="https:');
    for (const text of [
      '—',
      'Известная часть',
      'Нет данных за этот день',
      '180,32',
      '12,52',
    ])
      expect(html).toContain(text);
  });
  it('formats official totals and tiny deltas without altering authoritative decimal calculations', () => {
    const day = syntheticDay();
    day.totals = {
      calories: '180.3200',
      protein: '1.005',
      fat: '3.4499999999999997',
      carbs: '6.1499999999999995',
    };
    day.delta = {
      calories: '3e-16',
      protein: '-5e-16',
      fat: null,
      carbs: '-0.015',
    };
    const before = structuredClone(day);
    const html = renderReportHtml(
      request,
      { dailyStepsGoal: null, steps: [], days: [day], photos: [] },
      {
        sans: new Uint8Array(),
        bold: new Uint8Array(),
        serif: new Uint8Array(),
      },
    );
    for (const text of ['180,32', '1,01', '3,45', '6,15'])
      expect(html).toContain(text);
    for (const raw of [
      '3.4499999999999997',
      '6.1499999999999995',
      '3e-16',
      '-5e-16',
      '<dd>-0</dd>',
    ])
      expect(html).not.toContain(raw);
    expect(day).toEqual(before);
    expect(summarizeDays([day, day], 2).totals.protein).toBe('2.01');
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

it('preserves source quantity, serving and zero consumed portions without deriving missing mass', () => {
  const day = syntheticDay();
  const entry = day.meals[0]!.entries[0]!;
  Object.assign(entry, {
    massG: null,
    volumeMl: null,
    amount: '0.5',
    serving: 'package',
    servingQuantity: '0.75',
    consumedPortions: '0',
  });
  const before = structuredClone(day);
  const html = renderReportHtml(
    request,
    { dailyStepsGoal: null, steps: [], days: [day], photos: [] },
    { sans: new Uint8Array(), bold: new Uint8Array(), serif: new Uint8Array() },
  );
  expect(html).toContain('Количество: 0,5');
  expect(html).toContain('упаковка × 0,75');
  expect(html).toContain('0 порций');
  expect(html).toContain('масса не указана');
  expect(day).toEqual(before);
});

it('renders a complete local report with foods, absent days and missing photo bytes', () => {
  const day = syntheticDay();
  day.meals[0]!.entries[0]!.name = 'Saved local food';
  const html = renderReportHtml(
    { ...request, period: 'custom', end: '2026-10-11' },
    {
      dailyStepsGoal: 10000,
      days: [day],
      steps: [{ date: request.start, steps: 0, source: 'YAZIO' }],
      photos: [
        {
          id: 'missing',
          date: request.start,
          daytime: 'breakfast',
          source: 'manual',
          observedAt: '2026-10-10T12:00:00Z',
          dataUri: null,
        },
      ],
    },
  );
  expect(html).toContain('Saved local food');
  expect(html).toContain('Нет данных за этот день');
  expect(html).toContain('Фотография не сохранена на устройстве, нужна сеть.');
  expect(html).not.toContain('src="null"');
  expect(html).toContain('Шаги');
});
