import { expect, test } from '@playwright/test';
import { testOrigin } from './origin';

test('real login reaches core sections, saves a workout, preserves a cached screen offline, purges logout data, and blocks a trainer', async ({
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
    .poll(() =>
      page.evaluate(async (expectedTitle) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open('yazio-offline-read-v1');
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        try {
          return await new Promise<boolean>((resolve) => {
            const read = database
              .transaction('resources')
              .objectStore('resources')
              .getAll();
            read.onsuccess = () =>
              resolve(
                read.result.some((row) =>
                  String(row.record?.body).includes(expectedTitle),
                ),
              );
          });
        } finally {
          database.close();
        }
      }, title),
    )
    .toBe(true);
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
