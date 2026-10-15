import { expect, it, vi } from 'vitest';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticDay } from '../unit/reports/fixtures';
vi.mock('server-only', () => ({}));
import { readReportFonts } from '@/server/pdf/fonts';
import { renderReportHtml } from '@/server/pdf/template';
import { prepareReportPage } from '@/server/pdf/renderer';
import { mealShares } from '@/server/pdf/shares';
import { reportMessages as m } from '@/features/reports';

it('omits empty canonical meals in paginated HTML/PDF, retaining real entries, photos and authoritative-only nutrients', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yazio-empty-meals-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 50;
      canvas.getContext('2d')!.fillRect(0, 0, 100, 50);
      return canvas.toDataURL();
    });
    const day = syntheticDay('2026-10-10', 0);
    const zero = { calories: '0', protein: '0', fat: '-0e+30', carbs: null };
    for (const meal of day.meals) {
      meal.totals = { ...zero };
      meal.knownTotals = { ...zero };
      meal.officialTotals = { ...zero };
    }
    const originalDayTotals = structuredClone(day.totals);
    const fonts = await readReportFonts();
    const request = {
      contractVersion: 1 as const,
      ownerId: 'synthetic',
      start: day.date,
      end: day.date,
      period: 'daily' as const,
      format: 'pdf' as const,
    };
    const empty = renderReportHtml(
      request,
      { steps: [], days: [day], photos: [] },
      fonts,
    );
    await prepareReportPage(page, empty);
    expect(await page.locator('.report-page .meal-block').count()).toBe(0);
    expect(await page.locator('.report-page .table-header').count()).toBe(0);
    expect(await page.locator('.report-page .legend--meals').count()).toBe(0);
    expect(await page.locator('.report-page .empty').allTextContents()).toEqual(
      [m.empty],
    );
    const emptyPath = join(directory, 'empty.pdf');
    await writeFile(
      emptyPath,
      await page.pdf({ format: 'A4', printBackground: true }),
    );
    const emptyText = execFileSync('pdftotext', [emptyPath, '-'], {
      encoding: 'utf8',
    });
    expect(emptyText).toContain(m.empty);
    for (const kind of ['breakfast', 'lunch', 'dinner', 'snack'] as const)
      expect(emptyText).not.toContain(m[kind]);

    // Breakfast stays absent; later meal indices must still use their original shares.
    const entry = syntheticDay(day.date).meals[0]!.entries[0]!;
    day.meals[1]!.entries = [
      {
        ...entry,
        meal: 'lunch',
        name: 'Синтетическая вода',
        totals: { calories: '0', protein: '0', fat: '0', carbs: '0' },
      },
    ];
    day.meals[1]!.totals.calories = '100';
    day.meals[3]!.officialTotals.protein = '1e-999';
    const sharesBefore = mealShares(day);
    const html = renderReportHtml(
      request,
      {
        steps: [],
        days: [day],
        photos: [
          {
            id: 'synthetic-photo',
            date: day.date,
            daytime: 'dinner',
            source: 'manual',
            observedAt: '2026-10-11T00:00:00Z',
            dataUri: png,
          },
        ],
      },
      fonts,
    );
    await prepareReportPage(page, html);
    expect(
      await page
        .locator('.report-page .meal-block')
        .evaluateAll((blocks) =>
          blocks.map((block) => (block as HTMLElement).dataset.meal),
        ),
    ).toEqual(['lunch', 'dinner', 'snack']);
    expect(
      await page
        .locator('.report-page .legend--meals [data-meal="breakfast"]')
        .count(),
    ).toBe(0);
    expect(
      await page
        .locator('.report-page .legend--meals [data-meal="lunch"]')
        .textContent(),
    ).toContain(`${sharesBefore.percentages![1]}%`);
    expect(await page.locator('.report-page .meal-media').count()).toBe(1);
    expect(await page.locator('.report-page .empty').count()).toBe(0);
    const image = page.locator('.report-page .meal-media img');
    expect(
      await image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return [
          img.naturalWidth / img.naturalHeight,
          getComputedStyle(img).objectFit,
          Math.abs(
            img.getBoundingClientRect().width -
              img.getBoundingClientRect().height,
          ),
        ];
      }),
    ).toEqual([2, 'cover', 0]);
    const path = join(directory, 'content.pdf');
    await writeFile(
      path,
      await page.pdf({ format: 'A4', printBackground: true }),
    );
    const text = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' });
    expect(text).not.toContain(m.breakfast);
    expect(text).toContain('Синтетическая вода');
    expect(text).toContain(m.dinner);
    expect(text).toContain(m.snack);
    expect(day.totals).toEqual(originalDayTotals);
    expect(mealShares(day)).toEqual(sharesBefore);

    const splitDay = structuredClone(day);
    splitDay.meals[1]!.totals = { ...zero };
    splitDay.meals[1]!.knownTotals = { ...zero };
    splitDay.meals[1]!.officialTotals = { ...zero };
    splitDay.meals[3]!.officialTotals = { ...zero };
    splitDay.meals[1]!.entries = Array.from({ length: 45 }, (_, index) => ({
      ...day.meals[1]!.entries[0]!,
      id: `synthetic-water-${index}`,
      name: `Синтетическая вода ${index + 1}`,
    }));
    await prepareReportPage(
      page,
      renderReportHtml(
        request,
        { steps: [], days: [splitDay], photos: [] },
        fonts,
      ),
    );
    expect(
      await page.locator('.report-page .meal-block').count(),
    ).toBeGreaterThan(1);
    expect(await page.locator('.report-page .meal-media').count()).toBe(0);
    expect(await page.locator('.report-page .entry').count()).toBe(45);
    expect(
      await page
        .locator('.report-page .meal-block:not([data-meal="lunch"])')
        .count(),
    ).toBe(0);
    const splitPath = join(directory, 'split.pdf');
    await writeFile(
      splitPath,
      await page.pdf({ format: 'A4', printBackground: true }),
    );
    expect(
      execFileSync('pdftotext', [splitPath, '-'], { encoding: 'utf8' }),
    ).toContain('Синтетическая вода 45');
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
