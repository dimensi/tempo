import { afterAll, expect, it, vi } from 'vitest';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticDay } from '../unit/reports/fixtures';
vi.mock('server-only', () => ({}));
import { generateReport, withReportSlot } from '@/server/pdf/service';
import { readReportFonts } from '@/server/pdf/fonts';
import { renderReportHtml } from '@/server/pdf/template';
import { prepareReportPage, renderPdfReport } from '@/server/pdf/renderer';
import type { ReportDataSource } from '@/server/pdf/source';
import type { ReportRequest } from '@/contracts/reports';
const directory = await mkdtemp(join(tmpdir(), 'yazio-pdf-tests-'));
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
it('generates real A4 daily/weekly/custom PDFs with Cyrillic embedded font, square image crop with preserved source aspect and complete unclipped text on every page', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Fully synthetic 2:1 image. No personal files or external requests.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 450;
      canvas.height = 225;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#28736b';
      context.fillRect(0, 0, 450, 225);
      context.fillStyle = '#fff';
      context.beginPath();
      context.arc(225, 112, 75, 0, Math.PI * 2);
      context.fill();
      return canvas.toDataURL('image/png');
    });
    const metadata = {
      id: 'synthetic-photo',
      date: '2026-10-10',
      daytime: 'breakfast' as const,
      source: 'manual' as const,
      observedAt: '2026-10-11T00:00:00Z',
    };
    // Valid PNG with trailing padding exercises C's accepted camera-file budget.
    const photo = Buffer.concat([
      Buffer.from(png.split(',')[1]!, 'base64'),
      Buffer.alloc(3 * 1024 * 1024),
    ]);
    const day = syntheticDay(undefined, 45);
    day.meals[0]!.entries[0]!.totals = {
      ...day.meals[0]!.entries[0]!.totals,
      fat: '3.4499999999999997',
      carbs: '6.1499999999999995',
    };
    day.delta = { ...day.delta, fat: '3e-16', carbs: '-5e-16' };
    const adapter: ReportDataSource = {
      getSteps: async () => [
        { date: '2026-10-10', steps: 12345, source: 'YAZIO' },
      ],
      getNutritionDays: async () => [day],
      listPhotos: async () => [metadata],
      readPhoto: async () => ({ bytes: photo, mime: 'image/png' }),
    };
    const base: ReportRequest = {
      contractVersion: 1,
      ownerId: 'synthetic-owner',
      start: '2026-10-10',
      end: '2026-10-10',
      period: 'daily',
      format: 'pdf',
    };
    for (const [period, end] of [
      ['daily', '2026-10-10'],
      ['weekly', '2026-10-16'],
      ['custom', '2026-10-12'],
    ] as const) {
      const result = await generateReport(
        adapter,
        { ...base, period, end },
        new AbortController().signal,
      );
      expect(result).toBeInstanceOf(Uint8Array);
      const filename = join(directory, `${period}.pdf`);
      await writeFile(filename, result);
      expect(execFileSync('pdfinfo', [filename], { encoding: 'utf8' })).toMatch(
        /Page size:\s+59[45]\.\d+ x 841\.\d+ pts \(A4\)/,
      );
      const fonts = execFileSync('pdffonts', [filename], { encoding: 'utf8' });
      expect(fonts).toMatch(/(?:Arial|DejaVuSans).*yes\s+yes\s+yes/);
      const text = execFileSync('pdftotext', ['-layout', filename, '-'], {
        encoding: 'utf8',
      });
      expect(text).toContain('Яйцо · запись 45');
      expect(text).toMatch(/Шаги:\s+12[\s\u00a0]345/);
      expect(text).toContain('—');
      expect(text).toContain('Известная часть');
      expect(text).toContain('12,52');
      expect(text).toContain('3,45');
      expect(text).toContain('6,15');

      for (const raw of [
        '3.4499999999999997',
        '6.1499999999999995',
        '3e-16',
        '-5e-16',
      ])
        expect(text).not.toContain(raw);
      const pages = text
        .split('\f')
        .filter(
          (content, index, array) => index < array.length - 1 || content.trim(),
        );
      for (const content of pages)
        expect(
          content.replace(/\d+\s*\/\s*\d+/g, '').trim().length,
        ).toBeGreaterThan(20);
      const embeddedImages = execFileSync('pdfimages', ['-list', filename], {
        encoding: 'utf8',
      });
      const crop = embeddedImages.match(/image\s+(\d+)\s+(\d+)/)!;
      expect(Math.abs(Number(crop[1]) - Number(crop[2]))).toBeLessThanOrEqual(
        1,
      );
      const bbox = execFileSync('pdftotext', ['-bbox', filename, '-'], {
        encoding: 'utf8',
      });
      for (const match of bbox.matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g,
      )) {
        expect(Number(match[1])).toBeGreaterThanOrEqual(30);
        expect(Number(match[3])).toBeLessThanOrEqual(565);
        expect(Number(match[4])).toBeLessThanOrEqual(830);
        if (
          Number(match[2]) < 780 &&
          !/^[\d/]+$/.test(
            match.input
              .slice(match.index + match[0].length)
              .split('</word>')[0]!
              .replace(/^>/, ''),
          )
        )
          expect(Number(match[4])).toBeLessThanOrEqual(784);
      }
      if (process.env.PDF_VERIFICATION_DIR && period === 'daily') {
        await writeFile(
          join(process.env.PDF_VERIFICATION_DIR, 'synthetic-report.pdf'),
          result,
        );
        execFileSync('pdftoppm', [
          '-f',
          '1',
          '-singlefile',
          '-scale-to',
          '1200',
          '-png',
          filename,
          join(process.env.PDF_VERIFICATION_DIR, 'synthetic-report'),
        ]);
        const photoPage =
          pages.findIndex((content) => content.includes('Яйцо · запись 1')) + 1;
        expect(photoPage).toBeGreaterThan(0);
        execFileSync('pdftoppm', [
          '-f',
          String(photoPage),
          '-singlefile',
          '-scale-to',
          '1200',
          '-png',
          filename,
          join(process.env.PDF_VERIFICATION_DIR, 'synthetic-photo-page'),
        ]);
      }
    }
    const html = renderReportHtml(
      base,
      {
        steps: [],
        days: [syntheticDay()],
        photos: [{ ...metadata, dataUri: png }],
      },
      await readReportFonts(),
    );
    const context = await browser.newContext({
      javaScriptEnabled: false,
      offline: true,
      serviceWorkers: 'block',
    });
    const preview = await context.newPage();
    const requests: string[] = [];
    preview.on('request', (request) => requests.push(request.url()));
    await prepareReportPage(preview, html);
    expect(requests.filter((url) => /^https?:|^file:/.test(url))).toEqual([]);
    const image = await preview.locator('img').evaluate((image) => ({
      fit: getComputedStyle(image).objectFit,
      ratio:
        (image as HTMLImageElement).naturalWidth /
        (image as HTMLImageElement).naturalHeight,
    }));
    expect(image).toEqual({ fit: 'cover', ratio: 2 });
    await preview.emulateMedia({ media: 'screen' });
    if (process.env.PDF_VERIFICATION_DIR)
      await preview.screenshot({
        path: join(process.env.PDF_VERIFICATION_DIR, 'synthetic-preview.png'),
        fullPage: true,
      });
    await context.close();
  } finally {
    await browser.close();
  }
}, 90000);

it('cancels real Chromium preparation and releases the report slot before the next request', async () => {
  const controller = new AbortController();
  const launch = chromium.launch.bind(chromium);
  let launched: Awaited<ReturnType<typeof launch>> | undefined;
  const monitor = vi
    .spyOn(chromium, 'launch')
    .mockImplementation(async (options) => {
      const browser = await launch(options);
      launched = browser;
      const newContext = browser.newContext.bind(browser);
      vi.spyOn(browser, 'newContext').mockImplementation(async (options) => {
        const context = await newContext(options);
        context.on('page', (page) =>
          page.once('domcontentloaded', () => controller.abort()),
        );
        return context;
      });
      return browser;
    });
  try {
    const request: ReportRequest = {
      contractVersion: 1,
      ownerId: 'synthetic-owner',
      start: '2026-10-10',
      end: '2026-10-10',
      period: 'daily',
      format: 'pdf',
    };
    const html = renderReportHtml(
      request,
      { steps: [], days: [syntheticDay(undefined, 300)], photos: [] },
      await readReportFonts(),
    );
    await expect(
      withReportSlot(() => renderPdfReport(html, controller.signal)),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(launched?.isConnected()).toBe(false);
    await expect(
      withReportSlot(async () => 'next request admitted'),
    ).resolves.toBe('next request admitted');
  } finally {
    monitor.mockRestore();
    await launched?.close();
  }
}, 30000);
