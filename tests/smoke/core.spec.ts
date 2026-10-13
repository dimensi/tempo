import { test, expect } from '@playwright/test';
import { testOrigin } from '../ci/origin';

test('production real login, diary, workout save/read, offline cold read, logout purge and trainer boundary', async ({
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
  const route = page.url();
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
              .transaction('bundle')
              .objectStore('bundle')
              .get('current');
            r.onsuccess = () =>
              resolve(
                !!r.result?.snapshot?.plannedWorkouts?.some(
                  (item: { title: string }) => item.title === expectedTitle,
                ),
              );
          });
        } finally {
          db.close();
        }
      }, title),
    )
    .toBe(true);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.goto(route);
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Изменить', exact: true }),
  ).toBeDisabled();
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
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('yazio-offline-read-v1');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        return await new Promise<boolean>((resolve) => {
          const r = db
            .transaction('bundle')
            .objectStore('bundle')
            .get('current');
          r.onsuccess = () => resolve(r.result === undefined);
        });
      } finally {
        db.close();
      }
    }),
  ).toBe(true);
  expect(
    (await page.request.get(`/api/workouts?ownerId=${owner}`)).status(),
  ).toBe(401);
  await page.getByLabel('Электронная почта').fill('trainer@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  let trainerLogin = page.waitForResponse((r) =>
    r.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const trainerResponse = await trainerLogin;
  if (trainerResponse.status() === 429) {
    const seconds = Number(
      trainerResponse.headers()['retry-after'] ??
        trainerResponse.headers()['x-retry-after'] ??
        10,
    );
    test.setTimeout(test.info().timeout + (seconds + 1) * 1000);
    await page.waitForTimeout((seconds + 1) * 1000);
    trainerLogin = page.waitForResponse((r) =>
      r.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await trainerLogin).status()).toBe(200);
  } else expect(trainerResponse.status()).toBe(200);
  await expect(page).toHaveURL('/');
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
  expect((await page.request.get('/api/offline/identity')).status()).toBe(403);
});
