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
  await page.getByText('Название и заметка', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Название (необязательно)', exact: true })
    .fill(title);
  await page
    .getByRole('button', { name: 'Добавить упражнения', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Поиск по названию', exact: true })
    .fill('Smoke squat');
  await page
    .getByRole('button', { name: 'Добавить вручную: Smoke squat', exact: true })
    .click();
  await page
    .getByLabel('Smoke squat, Подход 1, Вес, кг', { exact: true })
    .fill('0');
  await page
    .getByRole('button', { name: 'Сохранить план', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Завершить тренировку', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Техника: Smoke squat', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Smoke squat, Подход 1, Повторения', { exact: true })
    .fill('8');
  await page
    .getByRole('button', { name: 'Завершить тренировку', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Продолжить тренировку', exact: true }),
  ).toBeVisible();

  // An incomplete actual set must survive acknowledging an unrelated plan edit.
  await page
    .getByRole('button', { name: 'Добавить подход', exact: true })
    .click();
  await page
    .getByLabel('Smoke squat, Подход 2, Вес, кг', { exact: true })
    .fill('25');
  await page.getByText('План', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Сохранить план', exact: true })
    .click();
  await expect(
    page.getByText('Есть несохранённые изменения', { exact: true }),
  ).toBeVisible();
  const dayUrl = page.url();
  await page.goto('/diary');
  await page.goto(dayUrl);
  await expect(
    page.getByLabel('Smoke squat, Подход 2, Вес, кг', { exact: true }),
  ).toHaveValue('25');
  await page
    .getByLabel('Smoke squat, Подход 2, Вес, кг', { exact: true })
    .fill('');

  // Coalesce a note edit made while the previous result is being committed.
  const sending = Promise.withResolvers<void>();
  const releaseWrite = Promise.withResolvers<void>();
  let delayed = false;
  await page.route('**/api/offline/writes', async (route) => {
    if (route.request().method() === 'POST' && !delayed) {
      delayed = true;
      sending.resolve();
      await releaseWrite.promise;
    }
    await route.continue();
  });
  await page
    .getByLabel('Заметка к тренировке', { exact: true })
    .fill('First note');
  await sending.promise;
  await page
    .getByLabel('Заметка к тренировке', { exact: true })
    .fill('Final note');
  // Intentionally cross the input debounce while the first write is held.
  await page.waitForTimeout(900);
  releaseWrite.resolve();
  await expect
    .poll(async () => {
      const body = await (
        await page.request.get(`/api/workouts?ownerId=${owner}`)
      ).json();
      return body.data.sessions.find(
        (item: { title: string }) => item.title === title,
      )?.note;
    })
    .toBe('Final note');
  await page.unroute('**/api/offline/writes');

  await expect
    .poll(() => cachedReadBody(page, title).catch(() => ''))
    .toContain(title);
  const cachedWorkout = await cachedReadBody(page, title);
  const stalledRead = Promise.withResolvers<void>();
  const readStarted = Promise.withResolvers<void>();
  const readFinished = Promise.withResolvers<void>();
  await page.route('**/api/workouts?*', async (route) => {
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
    page.getByRole('button', { name: 'Техника: Smoke squat', exact: true }),
  ).toBeVisible();
  stalledRead.resolve();
  await readFinished.promise;
  await page.unroute('**/api/workouts?*');

  await context.setOffline(true);
  await expect(
    page.getByRole('button', { name: 'Техника: Smoke squat', exact: true }),
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
