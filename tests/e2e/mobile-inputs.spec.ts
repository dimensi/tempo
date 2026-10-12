import { test, expect, type Page } from '@playwright/test';

async function audit(page: Page, touch: boolean) {
  const controls = page.locator(
    "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='range']), select, textarea, .mantine-Input-input",
  );
  let checked = 0;
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    if (touch)
      expect(
        await control.evaluate((node) =>
          parseFloat(getComputedStyle(node).fontSize),
        ),
      ).toBeGreaterThanOrEqual(16);
    checked++;
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const viewport = await page
    .locator('meta[name="viewport"]')
    .getAttribute('content');
  expect(viewport).not.toMatch(
    /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/i,
  );
  return checked;
}

test('touch controls remain readable on login and all data forms without disabling zoom', async ({
  page,
}, info) => {
  const touch = info.project.use.hasTouch === true;
  await page.goto('/login');
  expect(await audit(page, touch)).toBeGreaterThanOrEqual(2);
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  let response = page.waitForResponse((r) =>
    r.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  let result = await response;
  if (result.status() === 429) {
    const seconds = Number(
      result.headers()['retry-after'] ??
        result.headers()['x-retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    response = page.waitForResponse((r) =>
      r.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    result = await response;
  }
  expect(result.ok()).toBe(true);
  await expect(page).toHaveURL('/');
  for (const route of [
    '/settings',
    '/measurements',
    '/workouts',
    '/analytics',
    '/reports',
  ]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await audit(page, touch);
  }
  await page.goto('/reports');
  const period = page.getByRole('combobox', { name: 'Период', exact: true });
  await expect(period).toBeEnabled();
  await period.click();
  await page.getByRole('option', { name: 'Неделя', exact: true }).click();
  await audit(page, touch);
  await page.goto('/diary');
  await page
    .getByRole('button', { name: 'Перейти к другой дате', exact: true })
    .click();
  const year = page.getByRole('textbox', { name: 'Год', exact: true });
  await expect(year).toBeVisible();
  expect(await audit(page, touch)).toBeGreaterThanOrEqual(3);
  await year.click();
  await expect(year).toBeFocused();
  await audit(page, touch);
});
