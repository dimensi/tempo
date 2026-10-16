import { test, expect } from '../ci/isolated-test';
import { testOrigin } from '../ci/origin';

test('production real login, diary, workout save/read, cached current screen, logout purge and trainer boundary', async ({
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
  const login = page.waitForResponse((r) =>
    r.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL('/');
  const owner = (await (await page.request.get('/api/auth/get-session')).json())
    .user.id as string;
  await page.goto('/diary');
  await expect(
    page.getByRole('heading', { name: 'Дневник питания', exact: true }),
  ).toBeVisible();
  await page.goto('/workouts');
  await page
    .getByRole('button', { name: 'Добавить тренировку', exact: true })
    .click();
  const title = `Production smoke ${test.info().project.name}`;
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
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open('yazio-offline-read-v1');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        try {
          return await new Promise<boolean>((resolve) => {
            const r = db
              .transaction('resources')
              .objectStore('resources')
              .getAll();
            r.onsuccess = () =>
              resolve(
                r.result.some((row) =>
                  String(row.record?.body).includes(expectedTitle),
                ),
              );
          });
        } finally {
          db.close();
        }
      }, title),
    )
    .toBe(true);
  await context.setOffline(true);
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  // Reconnect revalidates the current feature without replacing it.
  await expect(
    page.getByRole('link', { name: 'Изменить план', exact: true }),
  ).toBeVisible();
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
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('yazio-offline-read-v1');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        return await new Promise<boolean>((resolve) => {
          const r = db
            .transaction('resources')
            .objectStore('resources')
            .count();
          r.onsuccess = () => resolve(r.result === 0);
        });
      } finally {
        db.close();
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
  expect(
    (
      await page.request.post(`/api/workouts/plans?ownerId=${owner}`, {
        headers: { origin: testOrigin },
        data: {
          title: 'Denied smoke',
          description: '',
          startsOn: '2026-01-01',
          endsOn: '2026-01-01',
          workouts: [
            {
              id: 'denied-smoke',
              date: '2026-01-01',
              title: 'Denied smoke',
              exercises: [{ name: 'Smoke', sets: [{ reps: 1, weightKg: 0 }] }],
            },
          ],
        },
      })
    ).status(),
  ).toBe(403);
  const denied = await page.request.get('/api/read/context');
  expect(denied.status()).toBe(403);
  expect(await denied.json()).toEqual({ error: 'ACCESS_REVOKED' });
});
