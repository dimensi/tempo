import 'server-only';
import { chromium, type Browser, type Page } from '@playwright/test';
import { ReportError } from '@/server/pdf/errors';
import { paginateReport } from '@/server/pdf/pagination';

export async function prepareReportPage(page: Page, html: string) {
  await page.setViewportSize({ width: 1200, height: 1600 });
  await page.context().route('**/*', (route) => route.abort());
  await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('12px "Report Sans"', 'Дневник питания'),
      document.fonts.load('700 12px "Report Sans"', 'Дневник питания'),
      document.fonts.load('12px "Report Serif"', 'Дневник питания'),
    ]);
    await document.fonts.ready;
    if (
      !document.fonts.check('12px "Report Sans"', 'Дневник питания') ||
      !document.fonts.check('700 12px "Report Sans"', 'Дневник питания') ||
      !document.fonts.check('12px "Report Serif"', 'Дневник питания')
    )
      throw new Error('Font failed');
    for (const image of document.images) {
      await image.decode();
      if (
        !image.naturalWidth ||
        image.naturalWidth * image.naturalHeight > 16_000_000
      )
        throw new Error('Invalid image');
      const ratio = Math.min(
        1,
        1200 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext('2d')!;
      const jpeg = image.src.startsWith('data:image/jpeg');
      if (jpeg) {
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9);
      image.width = canvas.width;
      image.height = canvas.height;
      await image.decode();
    }
  });
  await paginateReport(page);
  await page.evaluate(async () => {
    for (const image of document.images) await image.decode();
    if (document.documentElement.dataset.reportReady !== 'true')
      throw new Error('Report not ready');
  });
}
export async function renderPdfReport(
  html: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let browser: Browser | undefined;
  let onAbort: (() => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    signal?.throwIfAborted();
    browser = await chromium.launch({ headless: true, timeout: 15000 });
    signal?.throwIfAborted();
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      offline: true,
    });
    const page = await context.newPage();
    const operation = async () => {
      await prepareReportPage(page, html);
      return page.pdf({
        format: 'A4',
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        scale: 1,
      });
    };
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal?.reason ?? new Error('Aborted'));
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new ReportError('RUNTIME', 503)),
          25000,
        );
      }),
    ]);
  } catch {
    signal?.throwIfAborted();
    throw new ReportError('RUNTIME', 503);
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (deadline) clearTimeout(deadline);
    await browser?.close();
  }
}
