import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { syntheticDay } from '../unit/reports/fixtures';
test.use({ timezoneId: 'Europe/Moscow' });
const query = 'start=2026-10-10&end=2026-10-10&period=daily&format=pdf';
test('anonymous bytes denied and oversized period rejected', async ({
  request,
}) => {
  expect(
    (await request.get(`/api/reports?ownerId=owner&${query}`)).status(),
  ).toBe(401);
  expect(
    (
      await request.get(
        '/api/reports?ownerId=owner&period=custom&start=2026-01-01&end=2026-12-31&format=pdf',
      )
    ).status(),
  ).toBe(400);
});
test('persisted diary and private photo PDF API; real trainer grant and revocation', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await page.clock.setFixedTime(new Date('2026-10-11T21:30:00Z'));
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  let response = page.waitForResponse((value) =>
    value.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const signed = await response;
  if (signed.status() === 429) {
    await page.waitForTimeout(
      (Number(
        signed.headers()['retry-after'] ??
          signed.headers()['x-retry-after'] ??
          10,
      ) +
        1) *
        1000,
    );
    response = page.waitForResponse((value) =>
      value.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await response).ok()).toBe(true);
  } else expect(signed.ok()).toBe(true);
  await expect(page).toHaveURL('/');
  const ownerSession = await (
    await page.request.get('/api/auth/get-session')
  ).json();
  const ownerId = ownerSession.user.id as string;
  const origin = new URL(page.url()).origin;
  const requestedFormats: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/reports')
      requestedFormats.push(url.searchParams.get('format')!);
  });
  const date =
    test.info().project.name === 'desktop' ? '2026-02-03' : '2026-02-04';
  const scopedQuery = new URLSearchParams({
    ownerId,
    start: date,
    end: date,
    period: 'daily',
    format: 'pdf',
  });
  // Only disposable E2E storage; C's persisted snapshot format, no session mocks.
  const db = new Database('.data/e2e.sqlite');
  const day = syntheticDay(date);
  day.meals[0]!.entries[0]!.totals = {
    ...day.meals[0]!.entries[0]!.totals,
    fat: '3.4499999999999997',
    carbs: '6.1499999999999995',
  };
  day.delta = { ...day.delta, fat: '3e-16', carbs: '-5e-16' };
  try {
    db.prepare(
      'INSERT INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES(?,?,?,?)',
    ).run(ownerId, date, JSON.stringify(day), '2026-10-11T00:00:00Z');
  } finally {
    db.close();
  }
  const png = await page.evaluate((label) => {
    const canvas = document.createElement('canvas');
    canvas.width = 450;
    canvas.height = 225;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#28736b';
    ctx.fillRect(0, 0, 450, 225);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(225, 112, 75, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#17263a';
    ctx.fillText(label, 10, 20);
    return canvas.toDataURL('image/png');
  }, `Synthetic report ${test.info().project.name}`);
  const uploaded = await page.request.post(
    `/api/nutrition/photos?${new URLSearchParams({ ownerId, date, daytime: 'breakfast' })}`,
    {
      headers: { origin, 'content-type': 'image/png' },
      data: Buffer.from(png.split(',')[1]!, 'base64'),
    },
  );
  expect(uploaded.status()).toBe(201);
  const photo = await uploaded.json();
  const context = await browser.newContext();
  let trainerId: string | undefined;
  try {
    await page.goto('/reports');
    await expect(
      page.getByRole('heading', { name: 'Отчёты', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Начало')).toHaveValue('2026-10-12');
    await page.getByLabel('Начало').fill('10000-01-01');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Проверьте даты' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Отчёты', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Начало').fill('2026-10-12');
    await page.getByRole('combobox', { name: 'Период' }).click();
    await page
      .getByRole('option', { name: 'Произвольный период', exact: true })
      .click();
    await expect(page.getByLabel('Окончание')).toHaveValue('2026-10-12');
    await page.getByLabel('Окончание').fill('2026-10-13');
    await page.getByRole('combobox', { name: 'Период' }).click();
    await page.getByRole('option', { name: 'Неделя', exact: true }).click();
    await expect(page.getByLabel('Начало периода')).toHaveValue('2026-10-12');
    await expect(
      page.getByText(
        'Период отчёта: 12 октября 2026 г. — 18 октября 2026 г. · 7 дней',
        { exact: true },
      ),
    ).toBeVisible();
    for (const [start, label] of [
      ['2026-01-29', '29 января 2026 г. — 4 февраля 2026 г.'],
      ['2026-12-29', '29 декабря 2026 г. — 4 января 2027 г.'],
    ]) {
      await page.getByLabel('Начало периода').fill(start!);
      await expect(
        page.getByText(`Период отчёта: ${label} · 7 дней`, { exact: true }),
      ).toBeVisible();
    }
    expect(
      await page
        .getByLabel('Начало периода')
        .evaluate((input) =>
          Number.parseFloat(getComputedStyle(input).fontSize),
        ),
    ).toBeGreaterThanOrEqual(16);
    expect(
      await page
        .getByRole('combobox', { name: 'Период' })
        .evaluate((input) =>
          Number.parseFloat(getComputedStyle(input).fontSize),
        ),
    ).toBeGreaterThanOrEqual(16);
    await page.getByLabel('Начало периода').fill('2026-10-12');
    await page.getByRole('combobox', { name: 'Период' }).click();
    await page
      .getByRole('option', { name: 'Произвольный период', exact: true })
      .click();
    await expect(page.getByLabel('Окончание')).toHaveValue('2026-10-13');
    await page.getByLabel('Окончание').fill('');
    await page.getByRole('combobox', { name: 'Период' }).click();
    await page.getByRole('option', { name: 'День', exact: true }).click();
    await page.getByRole('combobox', { name: 'Период' }).click();
    await page
      .getByRole('option', { name: 'Произвольный период', exact: true })
      .click();
    await expect(page.getByLabel('Окончание')).toHaveValue('');
    await page.getByRole('combobox', { name: 'Период' }).click();
    await page.getByRole('option', { name: 'День', exact: true }).click();
    await page.screenshot({
      path: test.info().outputPath('reports-local-today.png'),
    });
    await page.getByLabel('Начало').fill(date);
    await page.getByRole('combobox', { name: 'Период' }).click();
    await page.getByRole('option', { name: 'Неделя', exact: true }).click();
    await expect(page.getByLabel('Начало')).toHaveValue(date);
    await page.getByRole('combobox', { name: 'Период' }).click();
    await page.getByRole('option', { name: 'День', exact: true }).click();
    await expect(page.getByLabel('Начало')).toHaveValue(date);
    await page.getByLabel('Начало').fill('');
    await page.getByRole('combobox', { name: 'Период' }).click();
    await page.getByRole('option', { name: 'Неделя', exact: true }).click();
    await expect(page.getByLabel('Начало')).toHaveValue('');
    await expect(page.getByText(/Период отчёта:/)).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Период' }).click();
    await page.getByRole('option', { name: 'День', exact: true }).click();
    await page.getByLabel('Начало').fill(date);
    await expect(
      page.getByRole('button', { name: 'Предпросмотр HTML' }),
    ).toHaveCount(0);
    const preview = page.frameLocator('iframe[title="Предпросмотр HTML"]');
    await expect(
      preview.getByText('Яйцо · запись 1', { exact: true }),
    ).toBeVisible();
    await expect(preview.locator('img')).toHaveCount(1);
    await expect(preview.getByText('3,45', { exact: true })).toBeVisible();
    await expect(preview.getByText('6,15', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath('reports-autoload-preview.png'),
      fullPage: true,
    });
    const previewRequests: string[] = [];
    let releaseStale!: () => void;
    const staleReady = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    await page.route('**/api/reports?**', async (route) => {
      const url = new URL(route.request().url());
      previewRequests.push(
        url.searchParams.get('format')! + ':' + url.searchParams.get('start'),
      );
      if (url.searchParams.get('start') === '2026-02-05') await staleReady;
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<html><body>Synthetic preview ${url.searchParams.get('start')}</body></html>`,
      });
    });
    try {
      await page.getByLabel('Начало').fill('2026-02-05');
      await expect
        .poll(() => previewRequests.includes('html:2026-02-05'))
        .toBe(true);
      await expect(
        preview.getByText('Яйцо · запись 1', { exact: true }),
      ).toBeVisible();
      await page.getByLabel('Начало').fill('2026-02-06');
      await page.getByLabel('Начало').fill('2026-02-07');
      await page.getByLabel('Начало').fill('2026-02-08');
      await expect(
        preview.getByText('Synthetic preview 2026-02-08'),
      ).toBeVisible();
      releaseStale();
      await expect(
        preview.getByText('Synthetic preview 2026-02-08'),
      ).toBeVisible();
      expect(previewRequests).toEqual(['html:2026-02-05', 'html:2026-02-08']);
      await page
        .getByRole('button', {
          name: 'понедельник, 2 февраля 2026 г.',
          exact: true,
        })
        .click();
      await expect(page.getByLabel('Начало')).toHaveValue('2026-02-02');
      await expect(
        preview.getByText('Synthetic preview 2026-02-02'),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
      await expect(page.getByLabel('Начало')).toHaveValue('2026-10-12');
    } finally {
      releaseStale();
      await page.unroute('**/api/reports?**');
    }
    await page.getByLabel('Начало').fill(date);
    await expect(
      preview.getByText('Яйцо · запись 1', { exact: true }),
    ).toBeVisible();

    expect(
      (
        await page.request.get(`/api/reports?ownerId=another-owner&${query}`)
      ).status(),
    ).toBe(403);
    expect(requestedFormats.every((format) => format === 'html')).toBe(true);
    const pendingDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать PDF' }).click();
    const download = await pendingDownload;
    const path = test.info().outputPath('synthetic-report.pdf');
    await download.saveAs(path);
    expect(download.suggestedFilename()).toBe(`nutrition-${date}-${date}.pdf`);
    const text = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' });
    expect(text).toContain('Яйцо');
    expect(text).toContain('—');
    expect(text).toContain('12,52');
    expect(text).toContain('3,45');
    expect(text).toContain('6,15');
    expect(text).not.toContain('3e-16');
    expect(text).not.toContain('-5e-16');
    const embeddedImages = execFileSync('pdfimages', ['-list', path], {
      encoding: 'utf8',
    });
    const crop = embeddedImages.match(/image\s+(\d+)\s+(\d+)/)!;
    expect(Math.abs(Number(crop[1]) - Number(crop[2]))).toBeLessThanOrEqual(1);
    const htmlRequestsAfterDownload = requestedFormats.filter(
      (format) => format === 'html',
    ).length;
    // Cover the debounce window: completion must not spawn a redundant preview.
    await page.waitForTimeout(500);
    expect(requestedFormats.filter((format) => format === 'html')).toHaveLength(
      htmlRequestsAfterDownload,
    );
    const signIn = () =>
      context.request.post(`${origin}/api/auth/sign-in/email`, {
        headers: { origin },
        data: {
          email: 'trainer@example.test',
          password: 'Test-only-password-12345',
        },
      });
    let result = await signIn();
    if (result.status() === 429) {
      await page.waitForTimeout(
        (Number(
          result.headers()['retry-after'] ??
            result.headers()['x-retry-after'] ??
            10,
        ) +
          1) *
          1000,
      );
      result = await signIn();
    }
    expect(result.ok()).toBe(true);
    const trainerSession = await (
      await context.request.get(`${origin}/api/auth/get-session`)
    ).json();
    trainerId = trainerSession.user.id;
    const scopedUrl = `${origin}/api/reports?${scopedQuery}`;
    expect((await context.request.get(scopedUrl)).status()).toBe(403);
    const grant = { ownerId, trainerId };
    expect(
      (await page.request.post('/api/trainers', { data: grant })).ok(),
    ).toBe(true);
    const granted = await context.request.get(scopedUrl);
    expect(granted.status()).toBe(200);
    expect(granted.headers()['content-type']).toBe('application/pdf');
    expect((await granted.body()).subarray(0, 5).toString()).toBe('%PDF-');
    const trainerPage = await context.newPage();
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    await trainerPage.route('**/_next/**/*.js*', async (route) => {
      await scriptsReady;
      await route.continue();
    });
    try {
      await trainerPage.goto(`${origin}/reports`, { waitUntil: 'commit' });
      await expect(trainerPage.getByLabel('Начало')).toBeDisabled();
      await expect(
        trainerPage.getByRole('button', { name: 'Скачать PDF' }),
      ).toBeDisabled();
    } finally {
      releaseScripts();
    }
    await expect(trainerPage.getByLabel('Начало')).toBeEnabled();
    await expect(trainerPage.getByLabel('Идентификатор владельца')).toHaveCount(
      0,
    );
    await trainerPage.getByLabel('Начало').fill(date);
    await expect(
      trainerPage
        .frameLocator('iframe')
        .getByText('Яйцо · запись 1', { exact: true }),
    ).toBeVisible();
    expect(
      (await page.request.delete('/api/trainers', { data: grant })).ok(),
    ).toBe(true);
    expect((await context.request.get(scopedUrl)).status()).toBe(403);
    await trainerPage.reload();
    await expect(
      trainerPage.getByRole('button', { name: 'Скачать PDF' }),
    ).toBeDisabled();
  } finally {
    if (trainerId)
      await page.request.delete('/api/trainers', {
        data: { ownerId, trainerId },
      });
    await context.close();
    await page.request.delete(
      `/api/nutrition/photos/${photo.id}?ownerId=${ownerId}`,
      { headers: { origin } },
    );
    const db = new Database('.data/e2e.sqlite');
    try {
      db.prepare('DELETE FROM nutrition_days WHERE owner_id=? AND date=?').run(
        ownerId,
        date,
      );
    } finally {
      db.close();
    }
  }
});
