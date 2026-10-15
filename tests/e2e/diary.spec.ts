import { test, expect } from '../ci/isolated-test';
test('authenticated diary date navigation and empty state', async ({
  page,
}) => {
  await page.goto('/diary');
  await expect(page).toHaveURL('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
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
  await expect(page).toHaveURL('/');
  await page.goto('/diary?date=2026-01-01');
  await page.getByRole('button', { name: 'Перейти к другой дате' }).click();
  await page.getByRole('textbox', { name: 'Год', exact: true }).fill('2026');
  await page.getByLabel('Месяц', { exact: true }).selectOption('02');
  await page.getByLabel('День', { exact: true }).selectOption('03');
  await page.getByRole('button', { name: 'Открыть день' }).click();
  await expect(page).toHaveURL('/diary?date=2026-02-03');
  await expect(
    page.locator('[aria-current="date"]').filter({ visible: true }),
  ).toHaveAttribute('href', '/diary?date=2026-02-03');
  await expect(
    page
      .getByText('Данные за этот день пока не загружены.')
      .filter({ visible: true }),
  ).toBeVisible();
  for (const meal of ['Завтрак', 'Обед', 'Ужин', 'Перекус'])
    await expect(
      page.getByRole('heading', { name: meal, exact: true }),
    ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить фото' })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
