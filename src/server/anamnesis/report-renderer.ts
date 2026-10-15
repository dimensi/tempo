import 'server-only';
import { chromium, type Browser, type Page } from '@playwright/test';
import { ReportError } from '@/server/pdf/errors';

// Разбивает подготовленный Medical-отчёт по страницам A4: одна секция
// показателя может продолжаться на следующих листах построчно.
async function paginateMedicalReport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>('#report-source');
    if (!source) throw new Error('Report source missing');
    const sections = Array.from(source.children) as HTMLElement[];
    source.remove();
    const output = document.createElement('main');
    output.id = 'report-pages';
    document.body.append(output);
    const sheets: Array<{ element: HTMLElement; body: HTMLElement }> = [];
    const fits = (body: HTMLElement) =>
      body.scrollHeight <= body.clientHeight + 1 &&
      body.scrollWidth <= body.clientWidth + 1;
    function newSheet(section: HTMLElement) {
      const element = document.createElement('section');
      element.className = 'report-page';
      const header = document.createElement('header');
      header.className = 'page-header';
      const title = document.createElement('h1');
      title.textContent = document.title;
      const date = document.createElement('span');
      date.className = 'header-date';
      date.textContent = section.dataset.header!;
      header.append(title, date);
      const body = document.createElement('main');
      body.className = 'page-body';
      const footer = document.createElement('footer');
      footer.className = 'page-footer';
      const label = document.createElement('span');
      label.textContent = section.dataset.footer!;
      const number = document.createElement('span');
      number.className = 'page-number';
      footer.append(label, number);
      element.append(header, body, footer);
      output.append(element);
      const sheet = { element, body };
      sheets.push(sheet);
      return sheet;
    }
    let current = newSheet(sections[0]!);
    for (const section of sections) {
      const heading = document.createElement('h2');
      heading.className = 'marker-heading';
      heading.textContent = section.dataset.title!;
      const rows = Array.from(
        section.querySelectorAll<HTMLElement>('.observation-row'),
      );
      const tableHead = section.querySelector('.table-header');
      function addHeading() {
        const title = heading.cloneNode(true);
        const columns = tableHead?.cloneNode(true);
        current.body.append(title);
        if (columns) current.body.append(columns);
        return [title, ...(columns ? [columns] : [])];
      }
      let prefix = addHeading();
      for (const [index, row] of rows.entries()) {
        current.body.append(row);
        if (fits(current.body)) continue;
        row.remove();
        if (index === 0)
          prefix.forEach((node) => node.parentNode?.removeChild(node));
        current = newSheet(section);
        prefix = addHeading();
        current.body.append(row);
        if (!fits(current.body)) throw new Error('Observation cannot fit page');
      }
      const notes = section.querySelector('.section-notes');
      if (notes) {
        current.body.append(notes);
        if (!fits(current.body)) {
          notes.remove();
          current = newSheet(section);
          current.body.append(notes);
          if (!fits(current.body)) throw new Error('Notes exceed page');
        }
      }
    }
    if (!sheets.length) throw new Error('Report has no sections');
    for (const [index, sheet] of sheets.entries()) {
      sheet.element.querySelector('.page-number')!.textContent =
        `${index + 1} / ${sheets.length}`;
      if (!sheet.body.children.length || !fits(sheet.body))
        throw new Error('Prepared page overflow');
    }
    document.documentElement.dataset.reportReady = 'true';
  });
}

async function renderMedicalReport(
  html: string,
  signal?: AbortSignal,
  preview = false,
): Promise<Uint8Array | { html: string; pageCount: number }> {
  let browser: Browser | undefined;
  let onAbort: (() => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    signal?.throwIfAborted();
    browser = await chromium.launch({ headless: true, timeout: 15000 });
    signal?.throwIfAborted();
    onAbort = () => {
      void browser?.close().catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const context = await browser.newContext({
      javaScriptEnabled: true,
      serviceWorkers: 'block',
      offline: true,
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1200, height: 1600 });
    await page.context().route('**/*', (route) => route.abort());
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load('12px "Report Sans"', 'Анамнез'),
        document.fonts.load('700 12px "Report Sans"', 'Анамнез'),
        document.fonts.load('12px "Report Serif"', 'Анамнез'),
      ]);
      await document.fonts.ready;
    });
    if (!(await page.locator('html').getAttribute('data-report-ready')))
      await paginateMedicalReport(page);
    signal?.throwIfAborted();
    if (preview)
      return {
        html: await page.content(),
        pageCount: await page.locator('.report-page').count(),
      };
    const operation = async () =>
      page.pdf({
        format: 'A4',
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        scale: 1,
      });
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
    signal?.throwIfAborted();
    throw new ReportError('RUNTIME', 503);
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (deadline) clearTimeout(deadline);
    await browser?.close();
  }
}

export async function prepareMedicalReport(html: string, signal?: AbortSignal) {
  return (await renderMedicalReport(html, signal, true)) as {
    html: string;
    pageCount: number;
  };
}
export async function renderMedicalPdfReport(
  html: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return (await renderMedicalReport(html, signal)) as Uint8Array;
}
