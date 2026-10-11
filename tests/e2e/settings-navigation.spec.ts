import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  const response = page.waitForResponse((value) =>
    value.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const result = await response;
  if (result.status() === 429) {
    const seconds = Number(
      result.headers()['retry-after'] ??
        result.headers()['x-retry-after'] ??
        10,
    );
    await page.waitForTimeout((seconds + 1) * 1000);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
  }
  await expect(page).toHaveURL('/');
}

test('section navigation keeps form values through anchors and history', async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto('/settings');
  const navigation = page.getByRole('navigation', { name: 'Разделы настроек' });
  const startDate = page.getByLabel('Загрузить данные начиная с…');
  await startDate.fill('2026-10-01');
  await navigation
    .getByRole('link', { name: 'Синхронизация', exact: true })
    .click();
  await expect(page).toHaveURL('/settings#sync');
  await navigation
    .getByRole('link', { name: 'Доступ тренеров', exact: true })
    .click();
  await expect(page).toHaveURL('/settings#trainers');
  await expect(page.locator('#trainers')).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL('/settings#sync');
  await page.goForward();
  await expect(page).toHaveURL('/settings#trainers');
  await navigation
    .getByRole('link', { name: 'Подключение YAZIO', exact: true })
    .click();
  await expect(startDate).toHaveValue('2026-10-01');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (process.env.SETTINGS_SCREENSHOT_DIR) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({
      path: `${process.env.SETTINGS_SCREENSHOT_DIR}/settings-${testInfo.project.name}.png`,
      fullPage: true,
    });
  }
});

test('keyboard anchors focus the embedded section', async ({ page }) => {
  await login(page);
  await page.goto('/settings#trainers');
  await expect(page).toHaveURL('/settings#trainers');
  const navigation = page.getByRole('navigation', { name: 'Разделы настроек' });
  const connection = navigation.getByRole('link', {
    name: 'Подключение YAZIO',
    exact: true,
  });
  await connection.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/settings#connection');
  await expect(page.locator('#connection')).toBeFocused();
  await expect(connection).toHaveAttribute('aria-current', 'location');
});

test('trainer form keeps values and request errors when navigating sections', async ({
  page,
}) => {
  await login(page);
  await page.goto('/settings#trainers');
  await page.route('**/api/trainers/invitations', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  const trainerEmail = page.getByRole('textbox', { name: 'Email тренера' });
  await trainerEmail.fill('synthetic-trainer@example.test');
  await page
    .getByRole('button', { name: 'Создать приглашение', exact: true })
    .click();
  await expect(page.locator('#trainers').getByRole('alert')).toHaveText(
    'Не удалось выполнить запрос',
  );
  const navigation = page.getByRole('navigation', { name: 'Разделы настроек' });
  await navigation
    .getByRole('link', { name: 'Подключение YAZIO', exact: true })
    .click();
  await page.goBack();
  await expect(trainerEmail).toHaveValue('synthetic-trainer@example.test');
  await expect(page.locator('#trainers').getByRole('alert')).toHaveText(
    'Не удалось выполнить запрос',
  );
});
