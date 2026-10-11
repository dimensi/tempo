import { expect, test } from '@playwright/test';
const query = 'start=2026-10-10&end=2026-10-10&period=daily&format=pdf';
test('anonymous report bytes are denied, invalid request is bounded', async ({
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
test('real owner session opens mobile-safe controls and receives meaningful disconnected-source error; cross-owner export is denied', async ({
  page,
  browser,
}) => {
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  let response = page.waitForResponse((value) =>
    value.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const signIn = await response;
  if (signIn.status() === 429) {
    const seconds = Number(
      signIn.headers()['retry-after'] ??
        signIn.headers()['x-retry-after'] ??
        10,
    );
    await page.waitForTimeout((seconds + 1) * 1000);
    response = page.waitForResponse((value) =>
      value.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await response).ok()).toBe(true);
  } else expect(signIn.ok()).toBe(true);
  await expect(page).toHaveURL('/');
  await page.goto('/reports');
  await expect(
    page.getByRole('heading', { name: 'Отчёты', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Начало').fill('2026-10-10');
  await page.getByRole('button', { name: 'Предпросмотр HTML' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Источник дневника' }),
  ).toContainText('Источник дневника ещё не подключён');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await page.request.get(`/api/reports?ownerId=another-owner&${query}`)
    ).status(),
  ).toBe(403);
  await page.getByRole('button', { name: 'Скачать PDF' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Источник дневника' }),
  ).toContainText('Источник дневника ещё не подключён');
  const ownerSession = await (
    await page.request.get('/api/auth/get-session')
  ).json();
  const context = await browser.newContext();
  try {
    const signIn = () =>
      context.request.post('http://localhost:3100/api/auth/sign-in/email', {
        headers: { origin: 'http://localhost:3100' },
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
      await context.request.get('http://localhost:3100/api/auth/get-session')
    ).json();
    const scopedUrl = `http://localhost:3100/api/reports?ownerId=${ownerSession.user.id}&${query}`;
    expect((await context.request.get(scopedUrl)).status()).toBe(403);
    const grant = {
      ownerId: ownerSession.user.id,
      trainerId: trainerSession.user.id,
    };
    expect(
      (await page.request.post('/api/trainers', { data: grant })).ok(),
    ).toBe(true);
    expect((await context.request.get(scopedUrl)).status()).toBe(503);
    expect(
      (await page.request.delete('/api/trainers', { data: grant })).ok(),
    ).toBe(true);
    expect((await context.request.get(scopedUrl)).status()).toBe(403);
  } finally {
    await context.close();
  }
});
