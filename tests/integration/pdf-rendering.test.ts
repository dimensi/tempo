import { afterAll, expect, it, vi } from 'vitest';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticDay } from '../unit/reports/fixtures';
vi.mock('server-only', () => ({}));
import { generateReport, readReportFont } from '@/server/pdf/service';
import { renderReportHtml } from '@/server/pdf/template';
import { prepareReportPage } from '@/server/pdf/renderer';
import type { ReportDataSource } from '@/server/pdf/source';
import type { ReportRequest } from '@/contracts/reports';
const directory = await mkdtemp(join(tmpdir(), 'yazio-pdf-tests-'));
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
it('generates real A4 daily/weekly/custom PDFs with Cyrillic embedded font, correct image aspect and complete unclipped text on every page', async () => {
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
    const photo = Buffer.from(png.split(',')[1]!, 'base64');
    const adapter: ReportDataSource = {
      getNutritionDays: async () => [syntheticDay(undefined, 45)],
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
      expect(text).toContain('Неизвестно');
      expect(text).toContain('Известная часть');
      expect(text).toContain('12.5212');
      const pages = text
        .split('\f')
        .filter(
          (content, index, array) => index < array.length - 1 || content.trim(),
        );
      for (const content of pages)
        expect(
          content.replace(/\d+\s*\/\s*\d+/g, '').trim().length,
        ).toBeGreaterThan(20);
      expect(
        execFileSync('pdfimages', ['-list', filename], { encoding: 'utf8' }),
      ).toMatch(/image\s+450\s+225/);
      const bbox = execFileSync('pdftotext', ['-bbox', filename, '-'], {
        encoding: 'utf8',
      });
      for (const match of bbox.matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g,
      )) {
        expect(Number(match[1])).toBeGreaterThanOrEqual(30);
        expect(Number(match[3])).toBeLessThanOrEqual(565);
        expect(Number(match[4])).toBeLessThanOrEqual(825);
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
      }
    }
    const html = renderReportHtml(
      base,
      { days: [syntheticDay()], photos: [{ ...metadata, dataUri: png }] },
      await readReportFont(),
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
    const image = await preview
      .locator('img')
      .evaluate((image) => ({
        fit: getComputedStyle(image).objectFit,
        ratio:
          (image as HTMLImageElement).naturalWidth /
          (image as HTMLImageElement).naturalHeight,
      }));
    expect(image).toEqual({ fit: 'contain', ratio: 2 });
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
