import { test, expect } from '@playwright/test';
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
  await page.getByLabel('Вес (кг)', { exact: true }).fill('72.125');
  await page.getByLabel('Заметка', { exact: true }).fill('E2E manual record');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'E2E manual record' });
  await expect(row).toContainText('72.125');
  await row.getByRole('button', { name: 'Изменить', exact: true }).click();
  await page.getByLabel('Вес (кг)', { exact: true }).fill('71.5');
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
test('anonymous measurement API is protected', async ({ request }) => {
  expect((await request.get('/api/measurements?ownerId=owner')).status()).toBe(
    401,
  );
  expect(
    (
      await request.post('/api/measurements?ownerId=owner', { data: {} })
    ).status(),
  ).toBe(401);
});
