import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { day as syntheticDay } from '../unit/diary/fixture';
import { getSessionWith429Retry } from './auth-session';

test('diary uses the shared macro pie with explicit incomplete and zero states', async ({
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
  const ownerId = (await getSessionWith429Retry(page.request)).user.id;
  const date = syntheticDay.date;
  const database = new Database('.data/e2e.sqlite');
  const snapshot = structuredClone(syntheticDay);
  snapshot.totals = {
    calories: '1357.1',
    protein: '77.06',
    fat: '57.68',
    carbs: '126.92',
  };
  function save() {
    database
      .prepare(
        'INSERT OR REPLACE INTO nutrition_days (owner_id,date,snapshot,fetched_at) VALUES (?,?,?,?)',
      )
      .run(ownerId, date, JSON.stringify(snapshot), snapshot.fetchedAt);
  }
  try {
    save();
    await page.goto(`/diary?date=${date}`);
    const summary = page.getByRole('region', {
      name: 'Итоги дня',
      exact: true,
    });
    await expect(summary.locator('.mantine-PieChart-root')).toBeVisible();
    await expect(summary).toContainText('23,09%');
    await expect(summary).toContainText('1\u202f357,1 ккал');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const dir = process.env.DIARY_SCREENSHOT_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: `${dir}/${info.project.name}-light.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Переключить тему' }).click();
      await page.screenshot({
        path: `${dir}/${info.project.name}-dark.png`,
        fullPage: true,
      });
    }
    snapshot.totals.fat = null;
    save();
    await page.reload();
    await expect(summary).toContainText(
      'Доли БЖУ недоступны: данные неполные.',
    );
    await expect(summary.locator('.mantine-PieChart-root')).toHaveCount(0);
    snapshot.totals = { calories: '17', protein: '0', fat: '0', carbs: '0' };
    save();
    await page.reload();
    await expect(summary).toContainText('БЖУ равны нулю');
    await expect(summary).toContainText('17 ккал');
    await expect(summary.locator('.mantine-PieChart-root')).toHaveCount(0);
  } finally {
    database
      .prepare('DELETE FROM nutrition_days WHERE owner_id=? AND date=?')
      .run(ownerId, date);
    database.close();
  }
});
