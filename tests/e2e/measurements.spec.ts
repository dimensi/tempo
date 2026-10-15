import { getSessionWith429Retry } from './auth-session';
import { test, expect, type Page } from '../ci/isolated-test';

async function login(page: Page, role: 'owner' | 'trainer', origin: string) {
  const signIn = () =>
    page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: {
        email: `${role}@example.test`,
        password: 'Test-only-password-12345',
      },
    });
  let response = await signIn();
  if (response.status() === 429) {
    const seconds = Number(
      response.headers()['x-retry-after'] ??
        response.headers()['retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    response = await signIn();
  }
  expect(response.ok()).toBe(true);
  return (await getSessionWith429Retry(page.request)).user.id;
}

test('owner denial retains the complete local result for review', async ({
  page,
  baseURL,
}) => {
  await login(page, 'owner', baseURL!);
  await page.goto('/measurements');
  await page
    .getByRole('main')
    .getByLabel('Вес (кг)', { exact: true })
    .fill('72.125');
  await page.getByRole('main').getByLabel('Дата замера').fill('2026-10-11');
  await page
    .getByLabel('Заметка', { exact: true })
    .fill('Preserved synthetic draft');
  await page.route('**/api/offline/writes', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 403, json: { error: 'Forbidden' } })
      : route.continue(),
  );
  const denied = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/offline/writes') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await denied).status()).toBe(403);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const request = indexedDB.open('yazio-offline-writes-v1', 1);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction('state', 'readonly');
              const get = tx.objectStore('state').get('current');
              get.onsuccess = () =>
                resolve(
                  get.result.operations.find(
                    (item: {
                      operation: { payload: { data: { note: string } } };
                    }) =>
                      item.operation.payload.data.note ===
                      'Preserved synthetic draft',
                  ),
                );
              tx.oncomplete = () => db.close();
            };
          }),
      ),
    )
    .toMatchObject({
      status: 'review',
      reason: 'access',
      operation: {
        payload: {
          kind: 'measurement',
          data: {
            measuredAt: '2026-10-11',
            note: 'Preserved synthetic draft',
            values: [{ metric: 'weight', value: '72.125', unit: 'kg' }],
          },
        },
      },
    });
});

test('granted trainer reads measurements without write controls and cannot write directly', async ({
  page,
  browser,
  baseURL,
}) => {
  const ownerId = await login(page, 'owner', baseURL!);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL,
  });
  const trainer = await context.newPage();
  const trainerId = await login(trainer, 'trainer', baseURL!);
  const scope = { ownerId, trainerId };
  expect(
    (
      await page.request.post('/api/trainers', {
        headers: { origin: baseURL! },
        data: scope,
      })
    ).ok(),
  ).toBe(true);
  try {
    await trainer.goto('/measurements');
    await expect(
      trainer.getByText(
        'Тренер может просматривать замеры. Изменять их может только владелец.',
      ),
    ).toBeVisible();
    await expect(trainer.getByLabel('Вес (кг)', { exact: true })).toHaveCount(
      0,
    );
    for (const name of ['Сохранить', 'Изменить', 'Удалить']) {
      await expect(
        trainer.getByRole('button', { name, exact: true }),
      ).toHaveCount(0);
    }
    expect(
      (
        await trainer.request.get(`/api/measurements?ownerId=${ownerId}`)
      ).status(),
    ).toBe(200);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect(
        (
          await trainer.request.fetch(
            `/api/measurements${method === 'POST' ? '' : '/synthetic-id'}?ownerId=${ownerId}`,
            {
              method,
              headers: { origin: baseURL! },
              data: {},
            },
          )
        ).status(),
      ).toBe(403);
    }
    expect(
      (
        await page.request.post('/api/measurements?ownerId=foreign', {
          headers: { origin: baseURL! },
          data: {},
        })
      ).status(),
    ).toBe(403);
  } finally {
    await page.request.delete('/api/trainers', {
      headers: { origin: baseURL! },
      data: scope,
    });
    await context.close();
  }
});
test('owner creates, edits and deletes a manual measurement on mobile and desktop', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  const signIn = () =>
    page.waitForResponse((response) =>
      response.url().endsWith('/api/auth/sign-in/email'),
    );
  let response = signIn();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  let result = await response;
  if (result.status() === 429) {
    const seconds = Number(
      result.headers()['x-retry-after'] ??
        result.headers()['retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    response = signIn();
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    result = await response;
  }
  expect(result.ok()).toBe(true);
  await expect(page).toHaveURL('/');
  await page.goto('/measurements');
  await page
    .getByRole('main')
    .getByLabel('Вес (кг)', { exact: true })
    .fill('72.125');
  await page
    .getByRole('main')
    .getByLabel('Заметка', { exact: true })
    .fill('E2E manual record');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'E2E manual record' });
  await expect(row).toContainText('72.125');
  await row.getByRole('button', { name: 'Изменить', exact: true }).click();
  await page
    .getByRole('main')
    .getByLabel('Вес (кг)', { exact: true })
    .fill('71.5');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(row).toContainText('71.5');
  await page.reload();
  await expect(row).toContainText('71.5');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await row.getByRole('button', { name: 'Удалить', exact: true }).click();
  await row
    .getByRole('button', { name: 'Подтвердить удаление', exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('anonymous measurement API is protected', async ({ request, baseURL }) => {
  expect((await request.get('/api/measurements?ownerId=owner')).status()).toBe(
    401,
  );
  expect(
    (
      await request.post('/api/measurements?ownerId=owner', {
        headers: { origin: baseURL! },
        data: {},
      })
    ).status(),
  ).toBe(401);
});
