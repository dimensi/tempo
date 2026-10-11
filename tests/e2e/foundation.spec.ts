import { test, expect, type Page } from '@playwright/test';
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});
async function login(page: import('@playwright/test').Page, role = 'owner') {
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
  // The real Better Auth limit is 3 sign-ins / 10s per IP. Respect Retry-After.
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
}
test('anonymous routes are protected and registration is closed', async ({
  page,
  request,
}) => {
  for (const route of [
    '/',
    '/diary',
    '/measurements',
    '/workouts',
    '/analytics',
    '/reports',
    '/settings',
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL('/login');
  }
  expect((await request.get('/api/yazio/status')).status()).toBe(401);
  const result = await request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3100' },
    data: {
      name: 'Intruder',
      email: 'intruder@example.test',
      password: 'Test-only-password-12345',
      role: 'OWNER',
    },
  });
  expect(result.status()).toBeGreaterThanOrEqual(400);
});
test('owner shell, all pages, theme persistence, mobile overflow and logout', async ({
  page,
}) => {
  await login(page);
  await expect(
    page.getByRole('heading', { name: 'Обзор', exact: true }),
  ).toBeVisible();
  const original = await page
    .locator('html')
    .getAttribute('data-mantine-color-scheme');
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-mantine-color-scheme',
    original!,
  );
  const changed = await page
    .locator('html')
    .getAttribute('data-mantine-color-scheme');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute(
    'data-mantine-color-scheme',
    changed!,
  );
  for (const [route, title] of [
    ['/diary', 'Дневник питания'],
    ['/measurements', 'Замеры'],
    ['/workouts', 'Тренировки'],
    ['/analytics', 'Аналитика'],
    ['/reports', 'Отчёты'],
    ['/settings', 'Настройки'],
  ]) {
    await page.goto(route!);
    await expect(
      page.getByRole('heading', { name: title!, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect((await page.request.get('/api/yazio/status')).status()).toBe(200);
  const menu = page.getByRole('button', { name: 'Навигация', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/login');
  expect((await page.request.get('/api/yazio/status')).status()).toBe(401);
});
test('trainer cannot access owner configuration or elevate their role', async ({
  page,
}) => {
  await login(page, 'trainer');
  expect((await page.request.get('/api/yazio/status')).status()).toBe(403);
  await page.request.post('/api/auth/update-user', {
    headers: { origin: 'http://localhost:3100' },
    data: { role: 'OWNER' },
  });
  expect((await page.request.get('/api/yazio/status')).status()).toBe(403);
});
test('invalid login shows a useful error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('incorrect-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Не удалось войти' }),
  ).toBeVisible();
});
