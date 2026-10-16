import { expect, test, type Page } from '@playwright/test';
import { testOrigin } from './origin';

async function cachedReadBody(page: Page, expectedTitle: string) {
  return page.evaluate(async (title) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('yazio-offline-read-v1');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const read = database
          .transaction('resources')
          .objectStore('resources')
          .getAll();
        read.onsuccess = () => {
          const body = read.result.find((row) =>
            String(row.record?.body).includes(title),
          )?.record?.body;
          if (typeof body === 'string') resolve(body);
          else reject(new Error('Cached workout is missing'));
        };
        read.onerror = () => reject(read.error);
      });
    } finally {
      database.close();
    }
  }, expectedTitle);
}

test('real login reaches core sections, recovers a cached workout offline, purges logout data, and blocks a trainer', async ({
  page,
  context,
  request,
}) => {
  expect((await request.get('/api/workouts?ownerId=unknown')).status()).toBe(
    401,
  );
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  const login = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL('/');
  const owner = (await (await page.request.get('/api/auth/get-session')).json())
    .user.id as string;
  for (const route of [
    '/',
    '/measurements',
    '/analytics',
    '/reports',
    '/settings',
  ])
    expect((await page.goto(route))?.ok()).toBe(true);

  await page.goto('/diary');
  await expect(
    page.getByRole('heading', { name: 'Дневник питания', exact: true }),
  ).toBeVisible();
  await page.goto('/workouts');
  await page
    .getByRole('button', { name: 'Добавить тренировку', exact: true })
    .click();
  const title = 'Production smoke workout';
  await page
    .getByRole('textbox', { name: 'Название (необязательно)', exact: true })
    .fill(title);
  await page
    .getByRole('combobox', { name: 'Упражнение', exact: true })
    .fill('Smoke squat');
  await page
    .getByRole('option', { name: 'Добавить вручную: Smoke squat', exact: true })
    .click();
  await page.getByLabel('Вес, кг', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(
    /\/workouts\/plans\/[^/]+\/workouts\/[^?]+\?date=/,
  );
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();

  await expect
    .poll(() => cachedReadBody(page, title).catch(() => ''))
    .toContain(title);
  const cachedWorkout = await cachedReadBody(page, title);
  const stalledRead = Promise.withResolvers<void>();
  const readStarted = Promise.withResolvers<void>();
  const readFinished = Promise.withResolvers<void>();
  await page.route('**/api/read/workout?*', async (route) => {
    readStarted.resolve();
    try {
      await stalledRead.promise;
      await route.fulfill({
        contentType: 'application/json',
        body: cachedWorkout,
      });
    } finally {
      readFinished.resolve();
    }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await readStarted.promise;
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  stalledRead.resolve();
  await readFinished.promise;
  await page.unroute('**/api/read/workout?*');

  await context.setOffline(true);
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await context.setOffline(false);

  await page.goto('/diary');
  const navigation = page.getByRole('button', {
    name: 'Навигация',
    exact: true,
  });
  if (await navigation.isVisible()) await navigation.click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/login');
  expect(
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('yazio-offline-read-v1');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        return await new Promise<boolean>((resolve) => {
          const count = database
            .transaction('resources')
            .objectStore('resources')
            .count();
          count.onsuccess = () => resolve(count.result === 0);
        });
      } finally {
        database.close();
      }
    }),
  ).toBe(true);
  expect(
    (await page.request.get(`/api/workouts?ownerId=${owner}`)).status(),
  ).toBe(401);

  const trainerLogin = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: testOrigin },
    data: {
      email: 'trainer@example.test',
      password: 'Test-only-password-12345',
    },
  });
  expect(trainerLogin.status()).toBe(200);
  expect(
    (await page.request.get(`/api/workouts?ownerId=${owner}`)).status(),
  ).toBe(403);
});
