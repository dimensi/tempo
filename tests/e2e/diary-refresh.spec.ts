import { getSessionWith429Retry } from './auth-session';
import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { nutritionDaySchema } from '@/contracts/nutrition';
import { day as syntheticDay } from '../unit/diary/fixture';

async function login(page: Page, role: 'owner' | 'trainer') {
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill(`${role}@example.test`);
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = page.waitForResponse((response) =>
      response.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const response = await pending;
    if (response.status() !== 429) {
      expect(response.ok()).toBe(true);
      break;
    }
    const seconds = Number(response.headers()['retry-after'] ?? 10);
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
  }
  await expect(page).toHaveURL('/');
  return (await getSessionWith429Retry(page.request)).user.id;
}

test('selected-day owner refresh deduplicates, separates photo warnings and ignores late navigation; trainer cannot refresh', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const date = '2024-02-29';
  const ownerId = await login(page, 'owner');
  await page.goto(`/diary?date=${date}`);
  let requests = 0;
  let completedRequests = 0;
  let finish!: () => void;
  let gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const result = {
    state: 'partial',
    startedAt: null,
    finishedAt: null,
    completedDates: [date],
    failedDates: [],
    photoFailedDates: [date],
  };
  await page.route('**/api/nutrition/days/*/refresh', async (route) => {
    requests++;
    expect(new URL(route.request().url()).pathname).toBe(
      `/api/nutrition/days/${date}/refresh`,
    );
    expect(Object.keys(route.request().postDataJSON())).toEqual(['timezone']);
    await gate;
    if (requests === 1) {
      const refreshed = nutritionDaySchema.parse({
        ...syntheticDay,
        date,
        meals: syntheticDay.meals.map((meal) => ({
          ...meal,
          ...(meal.entries.length
            ? {
                totals: syntheticDay.totals,
                knownTotals: syntheticDay.knownTotals,
                officialTotals: syntheticDay.officialTotals,
                delta: syntheticDay.delta,
              }
            : {}),
          entries: meal.entries.map((entry) => ({
            ...entry,
            diaryDateTime: date + entry.diaryDateTime.slice(10),
          })),
        })),
      });
      const database = new Database('.data/e2e.sqlite');
      try {
        database
          .prepare(
            'INSERT OR REPLACE INTO nutrition_days (owner_id, date, snapshot, fetched_at) VALUES (?, ?, ?, ?)',
          )
          .run(ownerId, date, JSON.stringify(refreshed), refreshed.fetchedAt);
      } finally {
        database.close();
      }
    }
    await route.fulfill({ json: result }).catch(() => {});
    completedRequests++;
  });
  const button = page.getByRole('button', {
    name: 'Обновить день',
    exact: true,
  });
  await button.focus();
  await button.press('Enter');
  await expect(button).toBeDisabled();
  await button.press('Enter');
  await expect(
    page.getByText('Обновляем еду и фотографии выбранного дня…'),
  ).toBeVisible();
  await expect.poll(() => requests).toBe(1);
  finish();
  await expect(
    page.getByText(
      'Еда за этот день обновлена. Часть фотографий пока недоступна.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Не удалось полностью обновить еду за этот день. Попробуйте ещё раз.',
    ),
  ).toHaveCount(0);
  await expect(button).toBeEnabled();
  expect(requests).toBe(1);
  await expect(
    page.getByText('Синтетический обед', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('diary-refresh-photo-warning.png'),
    fullPage: true,
  });

  gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await button.click();
  await expect.poll(() => requests).toBe(2);
  const otherDate = '2024-03-01';
  await page
    .getByRole('navigation', { name: 'Навигация по дням дневника' })
    .locator(`a[href="/diary?date=${otherDate}"]`)
    .click();
  await expect(page).toHaveURL(new RegExp(`date=${otherDate}`));
  await expect(
    page.getByRole('button', { name: 'Обновить день', exact: true }),
  ).toBeEnabled();
  finish();
  await expect.poll(() => completedRequests).toBe(2);
  await expect(
    page.getByText(
      'Еда за этот день обновлена. Часть фотографий пока недоступна.',
    ),
  ).toHaveCount(0);
  expect(requests).toBe(2);

  const trainerContext = await browser.newContext();
  const trainer = await trainerContext.newPage();
  try {
    const trainerId = await login(trainer, 'trainer');
    const database = new Database('.data/e2e.sqlite');
    try {
      database
        .prepare(
          'INSERT OR REPLACE INTO trainer_access (trainer_id, owner_id, created_at) VALUES (?, ?, ?)',
        )
        .run(trainerId, ownerId, Date.now());
    } finally {
      database.close();
    }
    await trainer.goto(`/diary?date=${date}`);
    await expect(
      trainer.getByRole('heading', { name: 'Дневник питания' }),
    ).toBeVisible();
    await expect(
      trainer.getByRole('button', { name: 'Обновить день', exact: true }),
    ).toHaveCount(0);
    const origin = new URL(trainer.url()).origin;
    expect(
      (
        await trainer.request.post(`/api/nutrition/days/${date}/refresh`, {
          headers: { origin },
          data: { timezone: 'UTC' },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await trainerContext.close();
  }
  expect(errors).toEqual([]);
});
