import { test, expect } from '../ci/isolated-test';
import { mkdirSync } from 'node:fs';

test('nutrition chart shares, missing and zero states fit the common content layout', async ({
  page,
}, info) => {
  await page.goto('/login');
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
      result.headers()['retry-after'] ??
        result.headers()['x-retry-after'] ??
        10,
    );
    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(0);
    expect(seconds).toBeLessThanOrEqual(30);
    await page.waitForTimeout((seconds + 1) * 1000);
    response = page.waitForResponse((value) =>
      value.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await response).ok()).toBe(true);
  } else expect(result.ok()).toBe(true);
  await expect(page).toHaveURL('/');
  let totals = {
    calories: '1357.1',
    protein: '77.06',
    fat: '57.68',
    carbs: '126.92',
  } as Record<string, string | null>;
  await page.route('**/api/overview?*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.nutrition.today = totals;
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  const nutrition = page.getByRole('region', { name: 'Питание сегодня' });
  await expect(nutrition).toContainText('1\u202f357,1');
  await expect(nutrition.locator('.mantine-PieChart-root')).toBeVisible();
  const chartBox = await nutrition
    .locator('.mantine-PieChart-root')
    .boundingBox();
  expect(chartBox!.width).toBe(180);
  expect(chartBox!.height).toBe(180);
  await expect(nutrition).toContainText('23,09% энергии');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const content = await page.locator('#main-content > div').boundingBox();
  expect(content!.width).toBeLessThanOrEqual(960);
  const screenshots = process.env.OVERVIEW_SCREENSHOT_DIR;
  if (screenshots) {
    mkdirSync(screenshots, { recursive: true });
    await page.screenshot({
      path: `${screenshots}/${info.project.name}-light.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Переключить тему' }).click();
    await page.screenshot({
      path: `${screenshots}/${info.project.name}-dark.png`,
      fullPage: true,
    });
  }
  totals = { ...totals, fat: null };
  await page.reload();
  await expect(nutrition).toContainText(
    'Доли БЖУ недоступны: данные неполные.',
  );
  await expect(nutrition.locator('.mantine-PieChart-root')).toHaveCount(0);
  totals = { calories: '17', protein: '0', fat: '0', carbs: '0' };
  await page.reload();
  await expect(nutrition).toContainText('БЖУ равны нулю');
  await expect(nutrition).toContainText('17');
  await expect(nutrition.locator('.mantine-PieChart-root')).toHaveCount(0);
});
