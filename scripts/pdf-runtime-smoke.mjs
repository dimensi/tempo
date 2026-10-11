import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
const output = process.argv[2];
assert.ok(output, 'Pass a disposable PDF output path');
if (process.env.NODE_ENV === 'production')
  assert.notEqual(process.getuid?.(), 0, 'Runtime PDF must render as non-root');
const fontPath =
  process.env.PDF_FONT_PATH ??
  (process.platform === 'darwin'
    ? '/System/Library/Fonts/Supplemental/Arial.ttf'
    : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
assert.ok(
  (await stat(fontPath)).size <= 2 * 1024 * 1024,
  'Font exceeds renderer limit',
);
const font = await readFile(fontPath);
assert.ok(existsSync(chromium.executablePath()), 'Locked Chromium is missing');
const browser = await chromium.launch({ headless: true, timeout: 15000 });
try {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    serviceWorkers: 'block',
    offline: true,
  });
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.setContent(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'unsafe-inline'"><style>@font-face{font-family:Report;src:url(data:font/ttf;base64,${font.toString('base64')}) format('truetype')}@page{size:A4;margin:14mm}body{font-family:Report;font-size:14pt}</style></head><body><h1>Дневник питания</h1><p>Проверка PDF · Синтетические данные · Яйцо</p></body></html>`,
    { waitUntil: 'load', timeout: 15000 },
  );
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (!document.fonts.check('12px Report', 'Дневник питания'))
      throw new Error('Cyrillic font missing');
  });
  assert.deepEqual(
    requests.filter((url) => /^https?:|^file:/.test(url)),
    [],
    'PDF attempted an external request',
  );
  const pdf = await page.pdf({
    format: 'A4',
    preferCSSPageSize: true,
    printBackground: true,
  });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await writeFile(output, pdf);
  console.log('Non-root locked Chromium/Cyrillic PDF smoke passed');
} finally {
  await browser.close();
}
