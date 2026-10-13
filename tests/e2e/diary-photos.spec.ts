import { getSessionWith429Retry } from './auth-session';
import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { nutritionDaySchema } from '@/contracts/nutrition';
import { day as syntheticDay } from '../unit/diary/fixture';

const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8O8AAAAASUVORK5CYII=',
  'base64',
);

async function login(page: Page, role: 'owner' | 'trainer') {
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill(`${role}@example.test`);
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  let response = page.waitForResponse((value) =>
    value.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const result = await response;
  if (result.status() === 429) {
    const seconds = Number(
      result.headers()['x-retry-after'] ??
        result.headers()['retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    response = page.waitForResponse((value) =>
      value.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await response).ok()).toBe(true);
  } else expect(result.ok()).toBe(true);
  await expect(page).toHaveURL('/', { timeout: 15000 });
  return (await getSessionWith429Retry(page.request)).user.id;
}

test('real diary photos and comments persist; trainer is read-only and revoked URLs are denied', async ({
  page,
  browser,
  request,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const ownerId = await login(page, 'owner');
  const date = `2026-04-${String(1 + (info.project.name === 'mobile' ? 10 : 0) + info.retry).padStart(2, '0')}`;
  const day = nutritionDaySchema.parse({
    ...syntheticDay,
    date,
    meals: syntheticDay.meals.map((meal) => ({
      ...meal,
      entries: meal.entries.map((entry) => ({
        ...entry,
        diaryDateTime: `${date} 12:34:56`,
      })),
    })),
  });
  // Test-only state in the disposable DB; production code never loads fixtures.
  const database = new Database('.data/e2e.sqlite');
  try {
    database
      .prepare(
        'INSERT OR REPLACE INTO nutrition_days (owner_id,date,snapshot,fetched_at) VALUES (?,?,?,?)',
      )
      .run(ownerId, date, JSON.stringify(day), day.fetchedAt);
  } finally {
    database.close();
  }

  await page.goto(`/diary?date=${date}`);
  await expect(
    page
      .getByRole('region', { name: 'Обед', exact: true })
      .getByText('Синтетический обед', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('123,46 ккал').first()).toBeVisible();
  const lunch = page.getByRole('region', { name: 'Обед', exact: true });
  await expect(
    page.getByRole('button', { name: 'Добавить фото', exact: true }),
  ).toHaveCount(0);
  // Existing manual photos remain supported by the authorized API, even without a diary upload control.
  const query = new URLSearchParams({ ownerId, date, daytime: 'lunch' });
  const upload = await page.request.post('/api/nutrition/photos?' + query, {
    headers: {
      Origin: new URL(page.url()).origin,
      'Content-Type': 'image/png',
    },
    data: image,
  });
  expect(upload.status()).toBe(201);
  const photo = await upload.json();
  expect(Object.keys(photo).sort()).toEqual([
    'date',
    'daytime',
    'id',
    'observedAt',
    'source',
  ]);
  await page.reload();
  await expect(
    lunch.getByText('Добавлено вручную', { exact: true }),
  ).toBeVisible();
  await page.reload();
  const photoImage = lunch.getByRole('img', {
    name: 'Обед — Добавлено вручную',
    exact: true,
  });
  await expect(photoImage).toBeVisible();
  await expect
    .poll(() =>
      photoImage.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  const photoUrl = (await photoImage.getAttribute('src'))!;
  expect((await page.request.get(photoUrl)).status()).toBe(200);
  expect((await request.get(photoUrl)).status()).toBe(401);
  expect(
    (
      await page.request.get(
        `/api/nutrition/photos/${photo.id}?ownerId=foreign`,
      )
    ).status(),
  ).toBe(403);

  await page.getByLabel('Комментарий').fill(`Комментарий к ${date}`);
  const commentResponse = page.waitForResponse(
    (value) =>
      value.url().endsWith('/api/comments') &&
      value.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  expect((await commentResponse).ok()).toBe(true);
  await page.reload();
  await expect(
    page.getByText(`Комментарий к ${date}`, { exact: true }),
  ).toBeVisible();

  const trainerContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
    baseURL: info.project.use.baseURL,
  });
  try {
    const trainerPage = await trainerContext.newPage();
    const trainerId = await login(trainerPage, 'trainer');
    expect(
      (
        await page.request.post('/api/trainers', {
          data: { ownerId, trainerId },
        })
      ).ok(),
    ).toBe(true);
    await trainerPage.goto(`/diary?date=${date}`);
    await expect(
      trainerPage
        .getByRole('region', { name: 'Обед', exact: true })
        .getByText('Синтетический обед', { exact: true }),
    ).toBeVisible();
    await expect(
      trainerPage.getByRole('img', {
        name: 'Обед — Добавлено вручную',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      trainerPage.getByRole('button', { name: 'Добавить фото' }),
    ).toHaveCount(0);
    await expect(
      trainerPage.getByRole('button', { name: 'Удалить фото' }),
    ).toHaveCount(0);
    expect((await trainerPage.request.get(photoUrl)).status()).toBe(200);
    expect(
      (
        await trainerPage.request.post(
          `/api/nutrition/photos?${new URLSearchParams({ ownerId, date, daytime: 'lunch' })}`,
          {
            headers: {
              'content-type': 'image/png',
              origin: info.project.use.baseURL!,
            },
            data: image,
          },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await trainerPage.request.delete(photoUrl, {
          headers: { origin: info.project.use.baseURL! },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.delete('/api/trainers', {
          data: { ownerId, trainerId },
        })
      ).ok(),
    ).toBe(true);
    expect((await trainerPage.request.get(photoUrl)).status()).toBe(403);
    await trainerPage.reload();
    await expect(
      trainerPage.getByText('Доступ к дневнику не предоставлен.'),
    ).toBeVisible();
    await expect(
      trainerPage.getByText('Синтетический обед', { exact: true }),
    ).toHaveCount(0);
    expect(
      await trainerPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await trainerContext.close();
  }

  await lunch.getByRole('button', { name: 'Удалить фото' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Отмена', exact: true })
    .click();
  expect((await page.request.get(photoUrl)).status()).toBe(200);
  await lunch.getByRole('button', { name: 'Удалить фото' }).click();
  const deleted = page.waitForResponse(
    (value) =>
      value.request().method() === 'DELETE' &&
      value.url().includes('/api/nutrition/photos/'),
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Удалить фото', exact: true })
    .click();
  expect((await deleted).ok()).toBe(true);
  await expect(
    lunch.getByText('Добавлено вручную', { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  expect((await page.request.get(photoUrl)).status()).toBe(404);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
