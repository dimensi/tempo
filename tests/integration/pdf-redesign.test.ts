import { afterAll, expect, it, vi } from 'vitest';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  meals,
  type NutritionDay,
  type SafeMealPhotoView,
} from '@/contracts/nutrition';
import type { ReportDataset, ReportDataSource } from '@/server/pdf/source';
import { redesignDay } from '../unit/reports/redesign-fixtures';
import { formatDecimal } from '@/lib/number-display';
vi.mock('server-only', () => ({}));
import { generateReport } from '@/server/pdf/service';
import { readReportFonts } from '@/server/pdf/fonts';
import { renderReportHtml } from '@/server/pdf/template';
import { prepareReportPage, renderPdfReport } from '@/server/pdf/renderer';

const directory = await mkdtemp(join(tmpdir(), 'yazio-redesign-'));
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('renders the specified one-page compact day and six records, then measures photos, continuation, oversized records and calendar-day pages', async () => {
  const browser = await chromium.launch();
  try {
    const maker = await browser.newPage();
    const pictures = await maker.evaluate(() => {
      const draw = (width: number, height: number, jpeg = false) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#245e87';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#faf7e9';
        ctx.beginPath();
        ctx.arc(
          width / 2,
          height / 2,
          Math.min(width, height) * 0.3,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        return canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png');
      };
      return {
        portrait: draw(450, 600),
        landscape: draw(450, 300),
        rotated: draw(200, 400, true),
      };
    });
    // Insert genuine EXIF orientation=6 into a synthetic JPEG (raw 200x400 -> displayed 400x200).
    const jpeg = Buffer.from(pictures.rotated.split(',')[1]!, 'base64');
    const exif = Buffer.from([
      69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1,
      0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const marker = Buffer.alloc(4);
    marker[0] = 255;
    marker[1] = 225;
    marker.writeUInt16BE(exif.length + 2, 2);
    const oriented = `data:image/jpeg;base64,${Buffer.concat([jpeg.subarray(0, 2), marker, exif, jpeg.subarray(2)]).toString('base64')}`;
    const photo = (
      date: string,
      index: number,
      dataUri: string,
    ): ReportDataset['photos'][number] => ({
      id: `synthetic-${date}-${index}`,
      date,
      daytime: meals[index]!,
      source: 'yazio',
      observedAt: '2026-10-11T12:00:00Z',
      dataUri,
    });
    const baseline = redesignDay();
    const canonicalPhotos = [
      photo(baseline.date, 0, pictures.portrait),
      photo(baseline.date, 1, pictures.landscape),
      photo(baseline.date, 2, pictures.portrait),
    ];
    const many = redesignDay();
    many.meals[0]!.entries = Array.from({ length: 45 }, (_, index) => ({
      ...structuredClone(many.meals[0]!.entries[0]!),
      id: `long-${index}`,
      name: `Синтетическая длинная запись ${index + 1}: ${'развёрнутое описание продукта '.repeat(6)}`,
    }));
    const enormous = redesignDay();
    enormous.meals[0]!.entries[0]!.name = 'Ш'.repeat(1500);
    const incomplete = redesignDay();
    incomplete.totals = { ...incomplete.totals, fat: null };
    incomplete.knownTotals = { ...incomplete.totals };
    const zero = redesignDay();
    zero.totals = { calories: '0', protein: '0', fat: '0', carbs: '0' };
    zero.knownTotals = { ...zero.totals };
    zero.meals.forEach((meal) => {
      meal.totals = { ...zero.totals };
    });
    const large = redesignDay();
    large.meals[0]!.entries[0]!.totals = {
      calories: '999999999.99',
      protein: '999999999.99',
      fat: '999999999.99',
      carbs: '999999999.99',
    };
    const totalsOnly = redesignDay();
    totalsOnly.meals.forEach((meal) => {
      meal.entries = [];
    });
    const empty = structuredClone(totalsOnly);
    const emptyTotals = {
      calories: '0',
      protein: null,
      fat: '-0e+10',
      carbs: '0',
    };
    empty.totals = { ...emptyTotals };
    empty.knownTotals = { ...emptyTotals };
    empty.officialTotals = { ...emptyTotals };
    empty.meals.forEach((meal) => {
      meal.totals = { ...emptyTotals };
      meal.knownTotals = { ...emptyTotals };
      meal.officialTotals = { ...emptyTotals };
    });
    const second = redesignDay('2026-10-12');
    const cases: Array<{
      name: string;
      days: NutritionDay[];
      photos: ReportDataset['photos'];
      expected?: number;
    }> = [
      {
        name: 'canonical',
        days: [baseline],
        photos: canonicalPhotos,
        expected: 1,
      },
      { name: 'no-photos', days: [baseline], photos: [] },
      { name: 'totals-only', days: [totalsOnly], photos: [] },
      { name: 'empty', days: [empty], photos: [], expected: 1 },
      {
        name: 'four-photos',
        days: [baseline],
        photos: [
          ...canonicalPhotos,
          photo(baseline.date, 3, pictures.landscape),
        ],
      },
      { name: 'many-records', days: [many], photos: canonicalPhotos },
      { name: 'oversized-record', days: [enormous], photos: canonicalPhotos },
      { name: 'incomplete', days: [incomplete], photos: [] },
      { name: 'zero', days: [zero], photos: [] },
      { name: 'large-values', days: [large], photos: canonicalPhotos },
      {
        name: 'exif-orientation',
        days: [baseline],
        photos: [photo(baseline.date, 0, oriented)],
      },
      {
        name: 'two-days',
        days: [baseline, second],
        photos: [
          ...canonicalPhotos,
          ...canonicalPhotos.map((p, index) =>
            photo(second.date, index, p.dataUri),
          ),
        ],
      },
    ];
    const fonts = await readReportFonts();
    for (const scenario of cases) {
      const request = {
        contractVersion: 1 as const,
        ownerId: 'synthetic-owner',
        start: scenario.days[0]!.date,
        end: scenario.days.at(-1)!.date,
        period:
          scenario.days.length > 1 ? ('custom' as const) : ('daily' as const),
        format: 'pdf' as const,
      };
      const context = await browser.newContext({
        javaScriptEnabled: false,
        offline: true,
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      const html = renderReportHtml(
        request,
        {
          dailyStepsGoal: 10000,
          steps: scenario.days.map((day, index) => ({
            date: day.date,
            steps: index === 0 ? 0 : null,
            source: index === 0 ? ('YAZIO' as const) : null,
          })),
          days: scenario.days,
          photos: scenario.photos,
        },
        fonts,
      );
      await prepareReportPage(page, html);
      expect(await page.locator('html').getAttribute('data-report-ready')).toBe(
        'true',
      );
      const count = await page.locator('.report-page').count();
      if (scenario.expected) expect(count).toBe(scenario.expected);
      expect(await page.locator('img').count()).toBe(scenario.photos.length);
      expect(await page.locator('.entry-meta').count()).toBe(
        scenario.days.reduce(
          (sum, day) =>
            sum + day.meals.reduce((n, meal) => n + meal.entries.length, 0),
          0,
        ),
      );
      const geometry = await page.evaluate(() => ({
        images: Array.from(document.images).map((image) => ({
          width: image.getBoundingClientRect().width,
          height: image.getBoundingClientRect().height,
          fit: getComputedStyle(image).objectFit,
          position: getComputedStyle(image).objectPosition,
        })),
        emptyMedia: Array.from(
          document.querySelectorAll('.meal-media:empty'),
        ).map((node) => node.getBoundingClientRect().height),
        columns: Array.from(
          document.querySelectorAll('.entry:not(.entry-fragment)'),
        ).map((entry) =>
          Array.from(entry.querySelectorAll('.nutrient-value')).map(
            (number) => number.getBoundingClientRect().right,
          ),
        ),
      }));
      for (const image of geometry.images)
        expect(image).toEqual({
          width: 120,
          height: 120,
          fit: 'cover',
          position: '50% 50%',
        });
      expect(geometry.emptyMedia).toEqual([]);
      for (const columns of geometry.columns)
        columns.forEach((right, index) =>
          expect(right).toBeCloseTo(geometry.columns[0]![index]!, 1),
        );
      expect(await page.locator('.meal-heading .meal-total').count()).toBe(
        scenario.name === 'empty' ? 0 : scenario.days.length * 16,
      );
      expect(await page.locator('.report-page:has(.meal-block)').count()).toBe(
        await page.locator('.table-header').count(),
      );
      expect(
        await page.locator('.nutrient-label,.meal-summary-table').count(),
      ).toBe(0);
      const names = await page.locator('.entry').evaluateAll((records) => {
        const grouped: Record<string, string> = {};
        for (const record of records) {
          const id = (record as HTMLElement).dataset.entryId!;
          grouped[id] =
            (grouped[id] ?? '') +
            record.querySelector('.entry-name')!.textContent!;
        }
        return grouped;
      });
      for (const day of scenario.days)
        for (const meal of day.meals)
          for (const entry of meal.entries)
            expect(names[entry.id]).toBe(entry.name);
      expect(await page.locator('.entry > .nutrient-value').count()).toBe(
        scenario.days.reduce(
          (n, day) =>
            n +
            day.meals.reduce((sum, meal) => sum + meal.entries.length * 4, 0),
          0,
        ),
      );
      if (scenario.name === 'canonical') {
        const bar = page.locator('.macro-bar');
        const measurements = await bar.evaluate((node) => ({
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
          segments: Array.from(node.children).map(
            (segment) => segment.getBoundingClientRect().width,
          ),
        }));
        expect(measurements.height).toBeCloseTo((3.2 * 96) / 25.4, 0);
        expect(
          measurements.segments.reduce((sum, width) => sum + width, 0),
        ).toBeCloseTo(measurements.width, 0);
        expect(
          await bar
            .locator('.segment')
            .evaluateAll((segments) =>
              segments.map((node) =>
                Number.parseFloat((node as HTMLElement).style.width),
              ),
            ),
        ).toEqual(
          [98.75 * 4, 76.55 * 9, 83.7 * 4].map((energy) =>
            expect.closeTo((energy / 1418.75) * 100, 4),
          ),
        );
        expect(
          measurements.segments.map(
            (width) => (width / measurements.width) * 100,
          ),
        ).toEqual(
          expect.arrayContaining([
            expect.closeTo(27.8, 1),
            expect.closeTo(48.6, 1),
            expect.closeTo(23.6, 1),
          ]),
        );
        expect(await page.locator('.energy-share').allTextContents()).toEqual([
          '27,8%',
          '48,6%',
          '23,6%',
        ]);
      }
      if (['zero', 'incomplete'].includes(scenario.name)) {
        expect(await page.locator('.macro-bar').count()).toBe(0);
        expect(await page.locator('.energy-share').allTextContents()).toEqual([
          '—',
          '—',
          '—',
        ]);
      }
      if (scenario.name === 'many-records') {
        expect(
          await page.locator('.meal-heading h2').allTextContents(),
        ).toContain('Завтрак · продолжение');
        expect(count).toBeGreaterThan(1);
      }
      if (scenario.name === 'oversized-record') {
        expect(
          await page
            .locator('[data-entry-id="synthetic-2026-10-11-0-0"]')
            .first()
            .locator('.nutrient-value')
            .count(),
        ).toBe(4);
        expect(
          (
            await page
              .locator('[data-entry-id="synthetic-2026-10-11-0-0"] .entry-name')
              .allTextContents()
          ).join(''),
        ).toBe('Ш'.repeat(1500));
      }
      if (scenario.name === 'no-photos')
        expect(await page.locator('img').count()).toBe(0);
      if (scenario.name === 'totals-only') {
        expect(await page.locator('.meal-block').count()).toBe(4);
        expect(await page.locator('.empty,.entry,.meal-media').count()).toBe(0);
        for (const meal of totalsOnly.meals) {
          expect(
            await page
              .locator(`.meal-block[data-meal="${meal.kind}"] .meal-total`)
              .allTextContents(),
          ).toEqual(
            Object.values(meal.totals).map(
              (value) => formatDecimal(value) ?? '—',
            ),
          );
        }
        expect(
          await page.locator('.daily-totals .numeric').allTextContents(),
        ).toEqual([
          formatDecimal(totalsOnly.totals.calories),
          '98,75',
          '27,8%',
          '76,55',
          '48,6%',
          '83,7',
          '23,6%',
        ]);
      }
      if (scenario.name === 'empty') {
        expect(
          await page
            .locator('.meal-block,.table-header,.meal-media,.legend--meals')
            .count(),
        ).toBe(0);
        expect(await page.locator('.empty').allTextContents()).toEqual([
          'Нет записей',
        ]);
      }
      if (scenario.name === 'exif-orientation')
        expect(
          await page
            .locator('img')
            .evaluate(
              (node) =>
                (node as HTMLImageElement).naturalWidth /
                (node as HTMLImageElement).naturalHeight,
            ),
        ).toBe(2);
      if (scenario.name === 'two-days') {
        const headers = await page
          .locator('.report-page[data-date="2026-10-12"] .page-header')
          .allTextContents();
        expect(headers.every((text) => text.includes('12 октября 2026'))).toBe(
          true,
        );
      }
      const pdf = await page.pdf({
        format: 'A4',
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        scale: 1,
      });
      const filename = join(directory, `${scenario.name}.pdf`);
      await writeFile(filename, pdf);
      const text = execFileSync('pdftotext', [filename, '-'], {
        encoding: 'utf8',
      });
      expect(text).not.toContain('mass-unavailable');
      expect(text).toContain('Текущая цель:');
      expect(text).toMatch(/0%\s+от цели/);
      expect(text).toContain('Шаги');
      expect(await page.locator('.steps-value').first().textContent()).toBe(
        '0',
      );
      if (scenario.name === 'two-days')
        expect(await page.locator('.steps-value').allTextContents()).toEqual([
          '0',
          '0',
          '—',
        ]);
      if (scenario.name === 'empty') expect(text).toContain('Нет записей');
      else if (scenario.name === 'totals-only') {
        expect(text).not.toContain('Нет записей');
        expect(text.replace(/\s/g, '')).toContain('1460,5');
        for (const label of ['Завтрак', 'Обед', 'Ужин', 'Перекус'])
          expect(text).toContain(label);
      } else {
        expect(text).toContain('00:00:00');
        expect(text.replace(/\s+/g, ' ')).toContain('масса не указана');
      }
      const allText = text.split('\f').filter((content) => content.trim());
      expect(allText.length).toBe(count);
      expect(allText.every((content) => content.trim().length > 30)).toBe(true);
      const bbox = execFileSync('pdftotext', ['-bbox', filename, '-'], {
        encoding: 'utf8',
      });
      for (const match of bbox.matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g,
      )) {
        expect(Number(match[1])).toBeGreaterThanOrEqual(30);
        expect(Number(match[3])).toBeLessThanOrEqual(565);
        expect(Number(match[4])).toBeLessThanOrEqual(830);
        expect(
          Number(match[4]) <= 61 ||
            (Number(match[2]) >= 66 && Number(match[4]) <= 784) ||
            Number(match[2]) >= 795,
          `${scenario.name}: ${match[0]}`,
        ).toBe(true);
      }
      const saved = process.env.PDF_VERIFICATION_DIR;
      if (saved) {
        await writeFile(join(saved, `${scenario.name}.pdf`), pdf);
        if (['canonical', 'oversized-record'].includes(scenario.name))
          execFileSync('pdftoppm', [
            '-scale-to',
            '1200',
            '-png',
            filename,
            join(saved, scenario.name),
          ]);
      }
      await context.close();
    }
    const bytes = Buffer.from(pictures.portrait.split(',')[1]!, 'base64');
    const metadata: SafeMealPhotoView = {
      id: 'bad-selected',
      date: baseline.date,
      daytime: 'breakfast',
      source: 'yazio',
      observedAt: '2026-10-11T12:00:00Z',
    };
    const adapter: ReportDataSource = {
      getStepsGoal: async () => null,
      getSteps: async () => [],
      getNutritionDays: async () => [baseline],
      listPhotos: async () => [metadata],
      readPhoto: async () => ({
        mime: 'image/png',
        bytes: bytes.subarray(0, 24),
      }),
    };
    await expect(
      generateReport(
        adapter,
        {
          contractVersion: 1,
          ownerId: 'synthetic-owner',
          start: baseline.date,
          end: baseline.date,
          period: 'daily',
          format: 'pdf',
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'RUNTIME' });
    await expect(
      renderPdfReport(
        '<!doctype html><html><body>No prepared report source</body></html>',
      ),
    ).rejects.toMatchObject({ code: 'RUNTIME' });
  } finally {
    await browser.close();
  }
}, 120000);
