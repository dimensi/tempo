import { expect, it, vi } from 'vitest';
import { chromium } from '@playwright/test';
import { syntheticDay } from '../unit/reports/fixtures';
vi.mock('server-only', () => ({}));
import { generateReport } from '@/server/pdf/service';
import type { ReportDataSource } from '@/server/pdf/source';
import { formatDecimal } from '@/lib/number-display';

it('displays natural-flow HTML and the real embedded photo with scripts/network blocked, without server pagination', async () => {
  const browser = await chromium.launch();
  try {
    const maker = await browser.newPage();
    const dataUri = await maker.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 450;
      canvas.height = 225;
      canvas.getContext('2d')!.fillRect(0, 0, 450, 225);
      return canvas.toDataURL();
    });
    const day = syntheticDay(undefined, 45);
    day.meals[0]!.entries[0]!.name = 'СинтетическоеДлинноеНазвание'.repeat(40);
    day.meals[0]!.entries[0]!.totals.calories = '999999999.99';
    const source: ReportDataSource = {
      getNutritionDays: async () => [day],
      listPhotos: async () => [
        {
          id: 'synthetic-photo',
          date: day.date,
          daytime: 'breakfast',
          source: 'manual',
          observedAt: '2026-10-11T00:00:00Z',
        },
      ],
      readPhoto: async () => ({
        bytes: Buffer.from(dataUri.split(',')[1]!, 'base64'),
        mime: 'image/png',
      }),
    };
    const monitor = vi.spyOn(chromium, 'launch');
    let html;
    try {
      html = await generateReport(
        source,
        {
          contractVersion: 1,
          ownerId: 'synthetic',
          start: day.date,
          end: day.date,
          period: 'daily',
          format: 'html',
        },
        new AbortController().signal,
      );
      expect(monitor).not.toHaveBeenCalled();
    } finally {
      monitor.mockRestore();
    }
    const context = await browser.newContext({
      javaScriptEnabled: false,
      offline: true,
      serviceWorkers: 'block',
    });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html as string);
    expect(await page.locator('.preview-header').textContent()).toContain(
      '10 октября 2026',
    );
    expect(await page.locator('.entry').count()).toBe(45);
    expect(await page.locator('.entry').last().textContent()).toContain(
      'Яйцо · запись 45',
    );
    expect(
      await page.locator('#report-pages,.report-page,script').count(),
    ).toBe(0);
    expect(
      await page.locator('html').getAttribute('data-report-ready'),
    ).toBeNull();
    expect(
      await page
        .locator('body')
        .evaluate((node) => getComputedStyle(node).fontFamily),
    ).toBe('Arial, system-ui, sans-serif');
    const image = page.locator('img');
    expect(await image.getAttribute('src')).toBe(dataUri);
    expect(
      await image.evaluate((node) => {
        const image = node as HTMLImageElement;
        const rect = image.getBoundingClientRect();
        return [
          image.naturalWidth,
          image.naturalHeight,
          rect.width,
          rect.height,
          getComputedStyle(image).objectFit,
        ];
      }),
    ).toEqual([450, 225, 120, 120, 'cover']);
    expect(
      await page
        .locator('.meal-entries')
        .first()
        .evaluate((node) => getComputedStyle(node).gridColumnStart),
    ).toBe('2');
    expect(
      await page
        .locator('.nutrient-value[data-nutrient="protein"]')
        .first()
        .evaluate((node) => getComputedStyle(node).color),
    ).toBe('rgb(35, 106, 168)');
    for (const width of [320, 375, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      expect(await page.locator('.entry-name').allTextContents()).toEqual(
        day.meals[0]!.entries.map((entry) => entry.name),
      );
      expect(
        await page
          .locator('.entry')
          .first()
          .locator('[data-nutrient="calories"]')
          .textContent(),
      ).toBe(formatDecimal('999999999.99'));
      const bounds = await page
        .locator('.entry-name,.nutrient-value,.meal-heading,.daily-totals,img')
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            return [rect.left, rect.right, rect.width, rect.height];
          }),
        );
      for (const [left, right, elementWidth, height] of bounds) {
        expect(left).toBeGreaterThanOrEqual(0);
        expect(right).toBeLessThanOrEqual(width);
        expect(elementWidth).toBeGreaterThan(0);
        expect(height).toBeGreaterThan(0);
      }
      expect(
        await image.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return [rect.width, rect.height];
        }),
      ).toEqual([120, 120]);
    }
  } finally {
    await browser.close();
  }
}, 30000);
