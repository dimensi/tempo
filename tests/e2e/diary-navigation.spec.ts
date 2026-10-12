import { test, expect, type Page } from '@playwright/test';

test.use({ timezoneId: 'Pacific/Kiritimati', reducedMotion: 'reduce' });

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = page.waitForResponse((value) =>
      value.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const result = await response;
    if (result.status() !== 429) {
      expect(result.ok()).toBe(true);
      break;
    }
    const seconds = Number(
      result.headers()['x-retry-after'] ??
        result.headers()['retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
  }
  await expect(page).toHaveURL('/');
}

test('real diary: week browsing, date selection, history and distant jump', async ({
  page,
}) => {
  await login(page);
  await page.goto('/diary?date=2024-02-29');
  const nav = page.getByRole('navigation', {
    name: 'Навигация по дням дневника',
  });
  const selected = nav.locator('[aria-current="date"]');
  await expect(selected).toHaveAttribute('href', '/diary?date=2024-02-29');
  let dataRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/diary?')) dataRequests++;
  });
  await nav.getByRole('button', { name: 'Следующая неделя' }).click();
  await expect(
    nav.getByRole('link', { name: 'понедельник, 4 марта 2024 г.' }),
  ).toBeVisible();
  await expect(page).toHaveURL('/diary?date=2024-02-29');
  expect(dataRequests).toBe(0);
  await expect(nav.getByText('Открыт день: 29 февраля 2024 г.')).toBeVisible();
  if (test.info().project.name === 'mobile') {
    await nav.getByRole('button', { name: 'Предыдущая неделя' }).click();
    const bounds = await nav.locator('a').first().boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const y = bounds!.y + 30;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 300, y }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 180, y }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await cdp.detach();
    await expect(
      nav.getByRole('link', { name: 'понедельник, 4 марта 2024 г.' }),
    ).toBeVisible();
    expect(dataRequests).toBe(0);
  }
  await nav.getByRole('link', { name: 'понедельник, 4 марта 2024 г.' }).click();
  await expect(page).toHaveURL('/diary?date=2024-03-04');
  await expect(selected).toHaveAttribute('href', '/diary?date=2024-03-04');
  await page.goBack();
  await expect(selected).toHaveAttribute('href', '/diary?date=2024-02-29');
  await page.goForward();
  await expect(selected).toHaveAttribute('href', '/diary?date=2024-03-04');
  await nav.getByRole('button', { name: 'Перейти к другой дате' }).click();
  await page.getByRole('textbox', { name: 'Год', exact: true }).fill('2027');
  await page.getByLabel('Месяц', { exact: true }).selectOption('01');
  await page.getByLabel('День', { exact: true }).selectOption('01');
  await page.screenshot({
    path: `test-results/day-jump-${test.info().project.name}.png`,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Открыть день' }).click();
  await expect(page).toHaveURL('/diary?date=2027-01-01');
  await expect(selected).toHaveAttribute('href', '/diary?date=2027-01-01');
  await expect(selected).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/diary?date=2024-03-04');
  await expect(selected).toHaveAttribute('href', '/diary?date=2024-03-04');
  await expect(selected).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL('/diary?date=2027-01-01');
  await expect(selected).toHaveAttribute('href', '/diary?date=2027-01-01');
  await expect(selected).toBeVisible();
  await expect(
    page.getByText('Данные за этот день пока не загружены.'),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const link of await nav.getByRole('link').all()) {
    const bounds = await link.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({
    path: `test-results/day-navigation-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test('date-less navigation resolves browser calendar day without UTC content flash', async ({
  page,
}) => {
  await login(page);
  await page.clock.install({ time: new Date('2026-12-31T12:30:00Z') });
  const today = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  await page.goto('/diary');
  await expect(page).toHaveURL(`/diary?date=${today}`);
  await expect(page.locator('[aria-current="date"]')).toHaveAttribute(
    'href',
    `/diary?date=${today}`,
  );
  await page.getByRole('button', { name: 'Следующая неделя' }).click();
  await expect(page.locator('[aria-current="date"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  await expect(page.locator('[aria-current="date"]')).toHaveAttribute(
    'href',
    `/diary?date=${today}`,
  );
});

test('slow day navigation shows pending state and the last keyboard selection wins', async ({
  page,
}) => {
  await login(page);
  await page.goto('/diary?date=2024-03-04');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/diary?*', async (route) => {
    const request = route.request();
    if (
      new URL(request.url()).searchParams.get('date') === '2024-03-05' &&
      request.headers()['rsc'] === '1'
    )
      await gate;
    await route.continue();
  });
  const nav = page.getByRole('navigation', {
    name: 'Навигация по дням дневника',
  });
  const first = nav.getByRole('link', { name: 'вторник, 5 марта 2024 г.' });
  try {
    await first.click();
    await expect(first.locator('[aria-busy="true"]')).toBeVisible();
    await expect(nav.locator('[aria-current="date"]')).toHaveAttribute(
      'href',
      '/diary?date=2024-03-04',
    );
    await nav.getByRole('link', { name: 'среда, 6 марта 2024 г.' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/diary?date=2024-03-06');
  } finally {
    release();
  }
  await page.unrouteAll({ behavior: 'wait' });
  await expect(nav.locator('[aria-current="date"]')).toHaveAttribute(
    'href',
    '/diary?date=2024-03-06',
  );
  await expect(nav.locator('[aria-busy="true"]')).toHaveCount(0);
});
