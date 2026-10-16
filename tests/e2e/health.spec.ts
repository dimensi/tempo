import { testOrigin } from '../ci/origin';
import { test, expect, type APIRequestContext } from '../ci/isolated-test';
import Database from 'better-sqlite3';
import {
  dateInTimezone,
  shiftDate,
} from '../../src/contracts/nutrition-sync-dates';

const timezone = 'America/Los_Angeles';
test.use({ timezoneId: timezone });
const today = () => dateInTimezone(new Date(), timezone);
async function login(request: APIRequestContext, role: 'owner' | 'trainer') {
  const signIn = () =>
    request.post('/api/auth/sign-in/email', {
      headers: { origin: testOrigin },
      data: {
        email: `${role}@example.test`,
        password: 'Test-only-password-12345',
      },
    });
  let response = await signIn();
  if (response.status() === 429) {
    const seconds = Number(
      response.headers()['x-retry-after'] ??
        response.headers()['retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    response = await signIn();
  }
  expect(response.status()).toBe(200);
}
test('synthetic health history has safe sources, zero/gaps, owner-confirmed kg and mobile geometry', async ({
  page,
}, testInfo) => {
  // This fixture only opens the disposable database configured by Playwright.
  const db = new Database('.data/e2e.sqlite');
  const owner = db
    .prepare("SELECT id FROM user WHERE role = 'OWNER'")
    .get() as { id: string };
  const trainer = db
    .prepare("SELECT id FROM user WHERE email = 'trainer@example.test'")
    .get() as { id: string };
  const from = shiftDate(today(), -6);
  const olderLocalDate = shiftDate(today(), -400);
  const observedAt = new Date().toISOString();
  const uuid = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const nullUuid = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  db.prepare(
    'INSERT OR REPLACE INTO yazio_daily_steps(owner_id,date,steps,observed_at) VALUES(?,?,?,?)',
  ).run(owner.id, today(), 0, observedAt);
  db.prepare(
    'INSERT OR REPLACE INTO yazio_daily_steps(owner_id,date,steps,observed_at) VALUES(?,?,?,?)',
  ).run(owner.id, from, 1234, observedAt);
  for (const [id, value] of [
    [uuid, '160.125'],
    [nullUuid, null],
  ])
    db.prepare(
      'INSERT OR REPLACE INTO yazio_weight_entries(owner_id,external_id,provider_date,measured_date,raw_value,unit,unit_context,observed_at) VALUES(?,?,?,?,?,NULL,?,?)',
    ).run(owner.id, id, today(), today(), value, 'lb', observedAt);
  db.prepare(
    'INSERT OR REPLACE INTO measurements(id,owner_id,measured_at,values_json) VALUES(?,?,?,?)',
  ).run(
    'health-e2e-manual',
    owner.id,
    from,
    JSON.stringify([{ metric: 'weight', value: '72.125', unit: 'kg' }]),
  );
  db.prepare(
    'INSERT OR REPLACE INTO measurements(id,owner_id,measured_at,values_json) VALUES(?,?,?,?)',
  ).run(
    'health-e2e-same-day',
    owner.id,
    today(),
    JSON.stringify([{ metric: 'weight', value: '71.875', unit: 'kg' }]),
  );
  db.prepare(
    'INSERT OR REPLACE INTO measurements(id,owner_id,measured_at,values_json) VALUES(?,?,?,?)',
  ).run(
    'health-e2e-older',
    owner.id,
    olderLocalDate,
    JSON.stringify([{ metric: 'weight', value: '68.5', unit: 'kg' }]),
  );
  try {
    await login(page.request, 'owner');
    await page.goto('/');
    const overview = page.getByRole('main').getByTestId('health-steps');
    await expect(overview).toContainText(`За выбранный день (${today()}): 0`);
    await expect(overview).toContainText('YAZIO');
    await expect(overview).toContainText('Дней с данными: 2 / 7');
    await expect(overview.locator('svg.recharts-surface')).toBeVisible();
    await expect(overview).toContainText('Пропущенные дни показаны разрывами');
    await expect(
      page.getByRole('heading', { name: 'Питание сегодня', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('synthetic-overview.png'),
      fullPage: true,
    });
    await page.goto(`/analytics?from=${from}&to=${today()}`);
    const steps = page.getByRole('main').getByTestId('health-steps');
    await steps
      .getByRole('button', { name: 'Показать данные по дням' })
      .click();
    const zero = steps.getByRole('row').filter({ hasText: today() });
    await expect(zero).toContainText('0');
    await expect(
      steps.getByRole('row').filter({ hasText: shiftDate(today(), -1) }),
    ).toContainText('Нет данных');
    await expect(steps).toContainText('617 шагов в среднем за день');
    const points = await (
      await page.request.get(`/api/health/steps?from=${from}&to=${today()}`)
    ).json();
    expect(points.days.at(-1).steps).toBe(0);
    expect(points.days[1].steps).toBeNull();
    expect(points.days).toHaveLength(7);
    await page.screenshot({
      path: testInfo.outputPath('synthetic-analytics.png'),
      fullPage: true,
    });
    await page
      .getByRole('main')
      .getByRole('button', { name: 'Период', exact: true })
      .click();
    await page.getByRole('textbox', { name: 'С', exact: true }).fill(today());
    await page.getByRole('textbox', { name: 'По', exact: true }).fill(today());
    await page.getByRole('button', { name: 'Показать', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`from=${today()}&to=${today()}`));
    await expect(steps).toContainText('Данные за 1 из 1 дней');
    await expect(steps).toContainText('0 шагов в среднем за день');
    await steps
      .getByRole('button', { name: 'Показать данные по дням' })
      .click();
    await expect(steps.getByRole('row')).toHaveCount(2);
    await page.goto('/measurements');
    const weights = page.getByRole('main').getByTestId('health-weight');
    await expect(weights).toContainText('Вручную');
    await expect(weights).toContainText('72,13');
    await expect(weights).toContainText('71,88');
    await expect(weights).toContainText('160,13');
    await expect(weights).not.toContainText('Единица неизвестна');
    await expect(weights).toContainText('Владелец подтвердил');
    await expect(weights).toContainText('Нет данных');
    const imported = weights.getByRole('row').filter({ hasText: '160,13' });
    await expect(imported).toContainText('YAZIO');
    await expect(imported).toContainText('кг');
    const weightChart = page
      .getByRole('main')
      .getByTestId('measurement-trend-chart');
    await expect(weightChart.locator('svg.recharts-surface')).toBeVisible();
    await expect(weightChart).toContainText('Замеры в приложении');
    await expect(weightChart).toContainText('YAZIO');
    expect(await weightChart.locator('.recharts-line').count()).toBe(2);
    await expect(weightChart.locator('.recharts-line-dot')).toHaveCount(4);
    await expect(weightChart).toContainText(olderLocalDate);
    await expect(
      page.getByRole('main').getByTestId('measurements-panel'),
    ).toContainText('Замеры в приложении — вся доступная история.');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await weights
        .locator('td')
        .evaluateAll((cells) =>
          cells.every(
            (cell) => parseFloat(getComputedStyle(cell).fontSize) >= 16,
          ),
        ),
    ).toBe(true);
    expect(
      await weights
        .locator('.mantine-Badge-label')
        .evaluateAll((labels) =>
          labels.every((label) => label.scrollWidth <= label.clientWidth + 1),
        ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('synthetic-health.png'),
      fullPage: true,
    });
    for (const status of [401, 403]) {
      await page.route('**/api/measurements?*', (route) =>
        route.fulfill({
          status,
          json: { error: status === 401 ? 'AUTH_REQUIRED' : 'ACCESS_REVOKED' },
        }),
      );
      await page.goto('/measurements');
      const panel = page.getByRole('main').getByTestId('measurements-panel');
      await expect(page).toHaveURL('/login');
      await expect(panel.getByTestId('measurement-trend-chart')).toHaveCount(0);
      await expect(panel).toHaveCount(0);
      await page.unroute('**/api/measurements?*');
      if (status === 401) await login(page.request, 'owner');
    }
    await login(page.request, 'trainer');
    db.prepare(
      'INSERT OR REPLACE INTO trainer_access(trainer_id,owner_id,created_at) VALUES(?,?,?)',
    ).run(trainer.id, owner.id, Date.now());
    await page.goto('/measurements');
    await expect(weights).toContainText('YAZIO');
    await expect(page.getByRole('main')).toContainText(
      'Тренер может просматривать замеры.',
    );
    await expect(
      page.getByRole('button', { name: 'Сохранить', exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.get(`/api/health/weight?from=${from}&to=${today()}`)
      ).status(),
    ).toBe(200);
    db.prepare('DELETE FROM trainer_access WHERE trainer_id = ?').run(
      trainer.id,
    );
    expect(
      (
        await page.request.get(`/api/health/steps?from=${from}&to=${today()}`)
      ).status(),
    ).toBe(403);
    await page.reload();
    await expect(weights).toHaveCount(0);
    await expect(page).toHaveURL('/login');
    expect(
      (
        await page.request.get(`/api/health/weight?from=${from}&to=${today()}`)
      ).status(),
    ).toBe(401);
  } finally {
    db.prepare(
      'DELETE FROM yazio_daily_steps WHERE owner_id = ? AND date IN (?,?)',
    ).run(owner.id, today(), from);
    db.prepare(
      'DELETE FROM yazio_weight_entries WHERE owner_id = ? AND external_id IN (?,?)',
    ).run(owner.id, uuid, nullUuid);
    db.prepare('DELETE FROM measurements WHERE id = ?').run(
      'health-e2e-manual',
    );
    db.prepare('DELETE FROM measurements WHERE id = ?').run(
      'health-e2e-same-day',
    );
    db.prepare('DELETE FROM measurements WHERE id = ?').run('health-e2e-older');
    db.prepare('DELETE FROM trainer_access WHERE trainer_id = ?').run(
      trainer.id,
    );
    db.close();
  }
});
