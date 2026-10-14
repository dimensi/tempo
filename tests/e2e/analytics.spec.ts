import { getSessionWith429Retry } from './auth-session';
import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { normalizeDay } from '@/features/nutrition/domain';
import { shiftDate, dateInTimezone } from '@/contracts/nutrition-sync-dates';
const timezone = 'America/Los_Angeles';
test.use({ timezoneId: timezone });
async function login(page: Page, role = 'owner') {
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill(`${role}@example.test`);
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  let response = page.waitForResponse((r) =>
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
    response = page.waitForResponse((r) =>
      r.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await response).ok()).toBe(true);
  } else expect(result.ok()).toBe(true);
  await expect(page).toHaveURL('/');
}
function fixture(
  date: string,
  calories: string | null,
  empty = false,
  unknownProtein = false,
) {
  const result = normalizeDay({
    date,
    fetchedAt: new Date().toISOString(),
    products: {},
    recipes: {},
    summary: { meals: {} },
    items: {
      products: [],
      recipe_portions: [],
      simple_products: empty
        ? []
        : [
            {
              id: `analytics-${date}`,
              date: `${date} 12:00:00`,
              daytime: 'lunch',
              name: 'Synthetic analytics fixture',
              is_ai_generated: false,
              nutrients: {
                'energy.energy': calories,
                'nutrient.protein': unknownProtein ? null : '145',
                'nutrient.fat': '82',
                'nutrient.carb': '210',
              },
            },
          ],
    },
  });
  if (calories === null) {
    // Retain a known lower bound alongside a separate unknown food entry.
    const partial = result.meals.find((meal) => meal.kind === 'lunch')!;
    const entry = partial.entries[0]!;
    partial.entries = [
      {
        ...entry,
        id: `${entry.id}-known`,
        totals: { calories: '1840', protein: '145', fat: '82', carbs: '210' },
      },
      {
        ...entry,
        id: `${entry.id}-unknown`,
        totals: { calories: null, protein: null, fat: null, carbs: null },
      },
    ];
    partial.totals = { calories: null, protein: null, fat: null, carbs: null };
    partial.knownTotals = {
      calories: '1840',
      protein: '145',
      fat: '82',
      carbs: '210',
    };
    result.totals = { ...partial.totals };
    result.knownTotals = { ...partial.knownTotals };
  }
  return result;
}
test('scoped analytics API, coverage, controls: hierarchy, comparisons, combined weight, disclosures and block failures', async ({
  page,
  browser,
  request,
}, info) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const from = '2026-10-01',
    to = '2026-10-14';
  const url = `/analytics?from=${from}&to=${to}&timezone=${encodeURIComponent(timezone)}`;
  const query = `/analytics/data?from=${from}&to=${to}&ownerId=`;
  expect((await request.get(query + 'foreign')).status()).toBe(401);
  await login(page);
  const ownerId = (await getSessionWith429Retry(page.request)).user.id;
  expect((await page.request.get(query + 'foreign')).status()).toBe(403);
  const db = new Database('.data/e2e.sqlite');
  const trainer = (
    db
      .prepare("SELECT id FROM user WHERE email='trainer@example.test'")
      .get() as { id: string }
  ).id;
  const nutritionDates: string[] = [];
  const stepsDates: string[] = [];
  const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const context = await browser.newContext({
    timezoneId: timezone,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  try {
    for (let i = 0; i < 28; i++) {
      const date = shiftDate(from, i - 14);
      const previous = i < 14;
      if (previous || i < 27) {
        const snapshot = fixture(
          date,
          i === 24 ? null : previous ? '1900' : '2100',
          i === 25,
          i === 26,
        );
        nutritionDates.push(date);
        db.prepare(
          'INSERT INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES(?,?,?,?)',
        ).run(ownerId, date, JSON.stringify(snapshot), snapshot.fetchedAt);
      }
      if (i !== 26) {
        stepsDates.push(date);
        db.prepare(
          'INSERT INTO yazio_daily_steps(owner_id,date,steps,observed_at) VALUES(?,?,?,?)',
        ).run(
          ownerId,
          date,
          previous ? 8000 : i === 27 ? 0 : 7400,
          new Date().toISOString(),
        );
      }
    }
    for (const [id, date, values] of [
      [
        'analytics-start',
        from,
        [
          { metric: 'weight', value: '110', unit: 'kg' },
          { metric: 'waist', value: '103', unit: 'cm' },
        ],
      ],
      ['analytics-end', to, [{ metric: 'waist', value: '99', unit: 'cm' }]],
    ] as const)
      db.prepare(
        'INSERT INTO measurements(id,owner_id,measured_at,values_json) VALUES(?,?,?,?)',
      ).run(id, ownerId, date, JSON.stringify(values));
    db.prepare(
      'INSERT INTO yazio_weight_entries(owner_id,external_id,provider_date,measured_date,raw_value,unit,unit_context,observed_at) VALUES(?,?,?,?,?,NULL,?,?)',
    ).run(ownerId, uuid, to, to, '108.6', 'kg', new Date().toISOString());
    const api = await page.request.get(query + ownerId);
    expect(api.status()).toBe(200);
    const data = await api.json();
    expect(data.nutrition).toMatchObject({
      state: 'ready',
      data: {
        completeDays: 10,
        partialDays: 2,
        emptyDays: 1,
        missingDays: 1,
        calorieMean: '2100',
      },
      comparison: { delta: '200' },
    });
    expect(data.body.data.metrics.weight.delta).toBe('-1.4');
    expect(data.body.data.metrics.weight.observations).toHaveLength(2);
    await page.goto(url);
    const main = page.getByRole('main').filter({ visible: true });
    await expect(
      main.getByRole('heading', { name: 'Главное за период' }),
    ).toBeVisible();
    await expect(
      main.getByRole('heading', { name: 'Что изменилось' }),
    ).toBeVisible();
    await expect(main).toContainText('108,6');
    await expect(main).toContainText('+200 ккал');
    const nutrition = main
        .getByTestId('analytics-nutrition')
        .filter({ visible: true }),
      body = main.getByTestId('analytics-body').filter({ visible: true }),
      steps = main.getByTestId('health-steps').filter({ visible: true });
    await expect(nutrition).toContainText('10 из 14 дней полностью заполнены');
    await expect(nutrition).toContainText('БЖУ рассчитано по 10 дням из 14');
    await expect(nutrition.locator('.recharts-bar')).toHaveCount(2);
    await expect(
      nutrition
        .locator('.recharts-bar-rectangle')
        .filter({ has: page.locator('path[fill^="url(#partial-"]') }),
    ).toHaveCount(2);
    await expect(steps.locator('.recharts-bar')).toHaveCount(1);
    await expect(main.getByRole('table')).toHaveCount(0);
    for (const panel of [nutrition, steps])
      await panel
        .getByRole('button', { name: 'Показать данные по дням' })
        .click();
    await body.getByRole('button', { name: 'Показать записи замеров' }).click();
    await expect(
      body.getByRole('cell', { name: '108,6', exact: true }),
    ).toBeVisible();
    await expect(
      body.getByRole('cell', { name: 'YAZIO', exact: true }),
    ).toBeVisible();
    await expect(
      nutrition.getByRole('row').filter({ hasText: '2026-10-11' }),
    ).toContainText('≥ 1\u202f840');
    await expect(
      nutrition.getByRole('row').filter({ hasText: '2026-10-12' }),
    ).toContainText('Пустой дневник');
    await expect(
      nutrition.getByRole('row').filter({ hasText: '2026-10-14' }),
    ).toContainText('Нет записи');
    await expect(steps.getByRole('row').filter({ hasText: to })).toContainText(
      '0',
    );
    for (const panel of [nutrition, steps])
      await panel
        .getByRole('button', { name: 'Показать данные по дням' })
        .click();
    await body.getByRole('button', { name: 'Показать записи замеров' }).click();
    if (info.project.name === 'mobile') {
      await body
        .getByRole('combobox', { name: 'Показатель', exact: true })
        .click();
      await page.getByRole('option', { name: 'Талия', exact: true }).click();
    } else await body.getByText('Талия', { exact: true }).click();
    await expect(body).toContainText('103 → 99 см');
    await expect(body).toContainText('-4 см');
    if (info.project.name === 'desktop') {
      await page.setViewportSize({ width: 800, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (info.project.name === 'mobile') {
      const activityValue = await main
        .getByRole('region', { name: 'Главное за период' })
        .getByText('6 830,77', { exact: true })
        .boundingBox();
      expect(activityValue).not.toBeNull();
      expect(activityValue!.y + activityValue!.height).toBeLessThanOrEqual(
        page.viewportSize()!.height,
      );
    }
    await page.screenshot({
      path: info.outputPath('analytics-viewport.png'),
      fullPage: false,
    });
    await page.screenshot({
      path: info.outputPath('analytics-light.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Переключить тему' }).click();
    await page.screenshot({
      path: info.outputPath('analytics-dark.png'),
      fullPage: true,
    });
    await main.getByRole('button', { name: '90 дней', exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `from=${shiftDate(dateInTimezone(new Date(), timezone), -89)}`,
      ),
    );
    await main.getByRole('button', { name: 'Период', exact: true }).click();
    await page.getByRole('textbox', { name: 'С', exact: true }).fill(from);
    await page.getByRole('textbox', { name: 'По', exact: true }).fill(to);
    await page.getByRole('button', { name: 'Показать', exact: true }).click();
    await expect(page).toHaveURL(/from=2026-10-01&to=2026-10-14/);
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(
        `from=${shiftDate(dateInTimezone(new Date(), timezone), -89)}`,
      ),
    );
    await page.goForward();
    await expect(page).toHaveURL(/from=2026-10-01/);
    await main.getByRole('button', { name: 'Период', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'С', exact: true })
      .fill('2026-10-15');
    await page.getByRole('button', { name: 'Показать', exact: true }).click();
    await expect(
      main.getByRole('alert').filter({ hasText: 'Выберите корректный период' }),
    ).toBeVisible();
    db.exec(
      'ALTER TABLE yazio_daily_steps RENAME TO analytics_steps_unavailable',
    );
    try {
      await page.goto(url);
      await expect(
        nutrition.getByRole('heading', { name: 'Питание', exact: true }),
      ).toBeVisible();
      await expect(body).toContainText('108,6');
      await expect(
        main
          .getByRole('alert')
          .filter({ hasText: 'Не удалось загрузить этот блок' }),
      ).toBeVisible();
      expect((await page.request.get(query + ownerId)).status()).toBe(200);
    } finally {
      db.exec(
        'ALTER TABLE analytics_steps_unavailable RENAME TO yazio_daily_steps',
      );
    }
    await main.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(steps).toContainText('Данные за 13 из 14 дней');
    const trainerPage = await context.newPage();
    await login(trainerPage, 'trainer');
    expect((await trainerPage.request.get(query + ownerId)).status()).toBe(403);
    db.prepare(
      'INSERT INTO trainer_access(trainer_id,owner_id,created_at) VALUES(?,?,?)',
    ).run(trainer, ownerId, Date.now());
    await trainerPage.goto(url);
    await expect(trainerPage.getByRole('main')).toContainText('108,6');
    expect((await trainerPage.request.get(query + 'foreign')).status()).toBe(
      403,
    );
    await expect(
      trainerPage.getByRole('link', { name: 'Обновить в настройках' }),
    ).toHaveCount(0);
    db.prepare('DELETE FROM trainer_access WHERE trainer_id=?').run(trainer);
    expect((await trainerPage.request.get(query + ownerId)).status()).toBe(403);
    await trainerPage.reload();
    await expect(trainerPage.getByRole('main')).toContainText(
      'Нет доступа к данным владельца.',
    );
    await page.goto('/analytics');
    const localToday = dateInTimezone(new Date(), timezone);
    await expect(page).toHaveURL(new RegExp(`to=${localToday}`));
    await expect(
      main.getByRole('heading', { name: 'Главное за период' }),
    ).toBeVisible();
    await page.goto('/analytics?from=2020-01-01&to=2020-01-03');
    await expect(nutrition).toContainText(
      'За этот период нет записей питания.',
    );
    await expect(steps).toContainText('За этот период нет данных о шагах.');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(browserErrors).toEqual([]);
  } finally {
    db.prepare('DELETE FROM trainer_access WHERE trainer_id=?').run(trainer);
    nutritionDates.forEach((date) =>
      db
        .prepare('DELETE FROM nutrition_days WHERE owner_id=? AND date=?')
        .run(ownerId, date),
    );
    stepsDates.forEach((date) =>
      db
        .prepare('DELETE FROM yazio_daily_steps WHERE owner_id=? AND date=?')
        .run(ownerId, date),
    );
    db.prepare(
      "DELETE FROM measurements WHERE id IN ('analytics-start','analytics-end')",
    ).run();
    db.prepare(
      'DELETE FROM yazio_weight_entries WHERE owner_id=? AND external_id=?',
    ).run(ownerId, uuid);
    db.close();
    await context.close();
  }
});
