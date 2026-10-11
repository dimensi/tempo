import 'server-only';
import { chromium, type Browser, type Page } from '@playwright/test';
import { ReportError } from '@/server/pdf/errors';

export async function prepareReportPage(page: Page, html: string) {
  await page.context().route('**/*', (route) => route.abort());
  await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (!document.fonts.check('12px Report', 'Дневник питания'))
      throw new Error('Font failed');
    for (const image of document.images) {
      await image.decode();
      if (
        !image.naturalWidth ||
        image.naturalWidth * image.naturalHeight > 16_000_000
      )
        throw new Error('Invalid image');
    }
  });
}
export async function renderPdf(html: string): Promise<Uint8Array> {
  let browser: Browser | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await chromium.launch({ headless: true, timeout: 15000 });
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
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="font-size:8px;width:100%;text-align:center;color:#536275"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
    };
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new ReportError('RUNTIME', 503)),
          25000,
        );
      }),
    ]);
  } catch {
    throw new ReportError('RUNTIME', 503);
  } finally {
    if (deadline) clearTimeout(deadline);
    await browser?.close();
  }
}
