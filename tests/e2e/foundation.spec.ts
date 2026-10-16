import Database from 'better-sqlite3';
import { testOrigin } from '../ci/origin';
import { test, expect, type Page } from '../ci/isolated-test';
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
test('route compositions mount with their server layout titles', async ({
  page,
}) => {
  await login(page);
  const routes = [
    ['/', 'Обзор'],
    ['/diary?date=2026-06-14', 'Дневник питания'],
    ['/workouts?date=2026-06-14', 'Тренировки'],
    ['/workouts/catalog', 'Каталог упражнений'],
    ['/measurements', 'Замеры'],
    ['/anamnesis', 'Анамнез'],
    ['/analytics?timezone=UTC&from=2026-06-01&to=2026-06-07', 'Аналитика'],
    ['/reports', 'Отчёты'],
    ['/settings', 'Настройки'],
  ];
  for (const [href, title] of routes) {
    const response = await page.goto(href!);
    expect(response?.status(), href).toBe(200);
    await expect(page).toHaveTitle(new RegExp(title!));
    if (href === '/workouts/catalog') {
      await expect(
        page.getByRole('button', { name: 'Следующие упражнения' }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole('main').getByRole('heading').first(),
      ).toBeVisible();
    }
  }
});

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
    headers: { origin: testOrigin },
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
  const navigationToggle = page.getByRole('button', {
    name: 'Навигация',
    exact: true,
  });
  if (await navigationToggle.isVisible()) {
    expect(await navigationToggle.boundingBox()).toMatchObject({
      width: 44,
      height: 44,
    });
    await navigationToggle.click();
  }
  await page
    .getByRole('link', { name: 'Дневник питания', exact: true })
    .click();
  const browserDate = await page.evaluate(() =>
    new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
  );
  await expect(page).toHaveURL(`/diary?date=${browserDate}`);
  await expect(
    page.getByRole('heading', { name: 'Дневник питания', exact: true }),
  ).toBeVisible();
  if (await navigationToggle.isVisible())
    await expect(navigationToggle).toHaveAttribute('aria-expanded', 'false');
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
  const settings = page.getByRole('main');
  const yazio = settings.getByRole('link', {
    name: 'Подключение YAZIO',
    exact: true,
  });
  const trainers = settings.getByRole('link', {
    name: 'Доступ тренеров',
    exact: true,
  });
  await expect(yazio).toBeVisible();
  await expect(trainers).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Навигация' })
      .getByRole('link', { name: 'Настройки', exact: true }),
  ).toHaveCount(1);
  await yazio.click();
  await expect(page).toHaveURL('/settings#connection');
  await page.goto('/settings');
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Доступ тренеров', exact: true })
    .click();
  await expect(page).toHaveURL('/settings#trainers');
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
  const fixture = new Database('.data/e2e.sqlite');
  fixture
    .prepare(
      "INSERT OR REPLACE INTO trainer_access(trainer_id,owner_id,created_at) SELECT t.id,o.id,? FROM user t,user o WHERE t.email='trainer@example.test' AND o.email='owner@example.test'",
    )
    .run(Date.now());
  fixture.close();
  await login(page, 'trainer');
  await page.goto('/settings');
  const settings = page.getByRole('main');
  await expect(
    settings.getByText(
      'Подключением YAZIO и доступом тренеров управляет владелец аккаунта.',
    ),
  ).toBeVisible();
  await expect(
    settings.getByRole('link', { name: 'Подключение YAZIO', exact: true }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole('link', { name: 'Доступ тренеров', exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get('/api/yazio/status')).status()).toBe(403);
  await page.request.post('/api/auth/update-user', {
    headers: { origin: testOrigin },
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
