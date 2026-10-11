import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { meals, type NutritionDay } from '@/contracts/nutrition';
async function login(page: Page, role = 'owner') {
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill(`${role}@example.test`);
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  const response = page.waitForResponse((r) =>
    r.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const result = await response;
  if (result.status() === 429) {
    await page.waitForTimeout(
      (Number(
        result.headers()['retry-after'] ??
          result.headers()['x-retry-after'] ??
          10,
      ) +
        1) *
        1000,
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
  }
  await expect(page).toHaveURL('/');
}
const query = '/analytics/data?from=2026-10-01&to=2026-10-03&ownerId=';
test('scoped analytics API, coverage, controls and mobile geometry', async ({
  page,
  browser,
  request,
}) => {
  expect((await request.get(query + 'foreign')).status()).toBe(401);
  await login(page);
  const ownerId = (
    await (await page.request.get('/api/auth/get-session')).json()
  ).user.id as string;
  expect((await page.request.get(query + 'foreign')).status()).toBe(403);
  const db = new Database('.data/e2e.sqlite');
  const trainerId = (
    db
      .prepare('SELECT id FROM user WHERE email = ?')
      .get('trainer@example.test') as { id: string }
  ).id;
  const totals = { calories: '100.1', protein: '10', fat: '2', carbs: '3' };
  const snapshot: NutritionDay = {
    date: '2026-10-01',
    fetchedAt: '2026-10-04T00:00:00Z',
    meals: meals.map((kind) => ({
      kind,
      entries: [],
      totals,
      knownTotals: totals,
      officialTotals: totals,
      delta: { calories: '0', protein: '0', fat: '0', carbs: '0' },
    })),
    totals,
    knownTotals: totals,
    officialTotals: totals,
    delta: { calories: '0', protein: '0', fat: '0', carbs: '0' },
  };
  // Synthetic records only in the disposable E2E database, removed in finally.
  db.prepare(
    'INSERT INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES(?,?,?,?)',
  ).run(ownerId, snapshot.date, JSON.stringify(snapshot), snapshot.fetchedAt);
  const context = await browser.newContext();
  try {
    const measurementResponse = await page.request.post(
      `/api/measurements?ownerId=${ownerId}`,
      {
        data: {
          measuredAt: '2026-10-02',
          values: [{ metric: 'weight', value: '80.125', unit: 'kg' }],
          note: null,
        },
      },
    );
    expect(measurementResponse.status()).toBe(201);
    const measurement = await measurementResponse.json();
    const response = await page.request.get(query + ownerId);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.summary.nutrients.calories).toMatchObject({
      total: '100.1',
      mean: '100.1',
      confirmedDays: 1,
    });
    expect(data.summary.days[1].totals.calories).toBeNull();
    expect(data.measurements[0].values[0].value).toBe('80.125');
    await page.goto('/analytics?from=2026-10-01&to=2026-10-03');
    await expect(
      page.getByText('Дней с записями: 1 / 3.', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: '80,13', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Месяц', exact: true }).click();
    await expect(page).toHaveURL(/from=.*&to=/);
    await page.getByLabel('С', { exact: true }).fill('2026-10-01');
    await page.getByLabel('По', { exact: true }).fill('2026-10-03');
    await page.getByRole('button', { name: 'Показать', exact: true }).click();
    await expect(page).toHaveURL('/analytics?from=2026-10-01&to=2026-10-03');
    await page.getByLabel('С', { exact: true }).fill('2026-10-04');
    await page.getByRole('button', { name: 'Показать', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Выберите корректный период',
    );
    const trainerPage = await context.newPage();
    await login(trainerPage, 'trainer');
    expect((await trainerPage.request.get(query + ownerId)).status()).toBe(403);
    db.prepare(
      'INSERT INTO trainer_access(trainer_id,owner_id,created_at) VALUES(?,?,?)',
    ).run(trainerId, ownerId, Date.now());
    expect((await trainerPage.request.get(query + ownerId)).status()).toBe(200);
    expect((await trainerPage.request.get(query + 'foreign')).status()).toBe(
      403,
    );
    db.prepare('DELETE FROM trainer_access WHERE trainer_id = ?').run(
      trainerId,
    );
    expect((await trainerPage.request.get(query + ownerId)).status()).toBe(403);
    await page.request.delete(
      `/api/measurements/${measurement.id}?ownerId=${ownerId}`,
    );
    await page.goto('/analytics?from=2020-01-01&to=2020-01-03');
    await expect(
      page.getByText('За этот период нет записей питания.'),
    ).toBeVisible();
  } finally {
    db.prepare('DELETE FROM trainer_access WHERE trainer_id = ?').run(
      trainerId,
    );
    db.prepare(
      'DELETE FROM nutrition_days WHERE owner_id = ? AND date = ?',
    ).run(ownerId, snapshot.date);
    db.prepare(
      'DELETE FROM measurements WHERE owner_id = ? AND measured_at = ?',
    ).run(ownerId, '2026-10-02');
    db.close();
    await context.close();
  }
});
