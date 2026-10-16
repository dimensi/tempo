import { signInFixture } from '../ci/real-auth';
import { getSessionWith429Retry } from './auth-session';
import { test, expect, type Page } from '../ci/isolated-test';
import { execFileSync } from 'node:child_process';
import {
  dateInTimezone,
  shiftDate,
} from '../../src/contracts/nutrition-sync-dates';
const timezone = 'America/Los_Angeles';
test.use({ timezoneId: timezone });
async function login(page: Page, role = 'owner') {
  if (role === 'trainer') return signInFixture(page, role);
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill(`${role}@example.test`);
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  let response = page.waitForResponse((r) =>
    r.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  let result = await response;
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
    result = await response;
  }
  expect(result.ok()).toBe(true);
  await expect(page).toHaveURL('/');
}
function fixture(today: string, mode: string) {
  execFileSync(
    process.execPath,
    ['--import', 'tsx', 'tests/overview/fixture.ts', today, mode],
    { env: { ...process.env, DATABASE_URL: 'file:./.data/e2e.sqlite' } },
  );
}
test.afterEach(() => fixture(dateInTimezone(new Date(), timezone), 'restore'));
test('real overview shows empty, partial and populated data with local dates and grant isolation', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  const today = dateInTimezone(new Date(), timezone);
  fixture(today, 'backup');
  expect((await page.request.get('/api/overview?timezone=UTC')).status()).toBe(
    401,
  );
  await login(page);
  const session = await getSessionWith429Retry(page.request);
  const ownerId = session.user.id;
  const headers = { origin: new URL(page.url()).origin };
  await page.route('**/api/overview?*', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  await page.reload();
  await expect(
    page.getByText('Не удалось загрузить обзор. Попробуйте ещё раз.'),
  ).toBeVisible();
  await page.unroute('**/api/overview?*');
  await page.evaluate(() => {
    // A background revalidation may already have recovered between these steps.
    const retry = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Повторить',
    );
    retry?.click();
  });
  fixture(today, 'empty');
  await page.reload();
  await expect(
    page.getByText('За этот день пока нет записей в дневнике.'),
  ).toBeVisible();
  if (process.env.OVERVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.OVERVIEW_SCREENSHOT_DIR}/overview-${info.project.name}-empty.png`,
      fullPage: true,
    });
  fixture(today, 'partial');
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Питание сегодня' }),
  ).toContainText('Нет данных');
  if (process.env.OVERVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.OVERVIEW_SCREENSHOT_DIR}/overview-${info.project.name}-partial.png`,
      fullPage: true,
    });
  fixture(today, 'populated');
  const measurement = await page.request.post(
    `/api/measurements?ownerId=${ownerId}`,
    {
      headers,
      data: {
        measuredAt: today,
        values: [{ metric: 'weight', value: '78.125', unit: 'kg' }],
        note: null,
      },
    },
  );
  expect(measurement.ok()).toBe(true);
  const previous = await page.request.post(
    `/api/measurements?ownerId=${ownerId}`,
    {
      headers,
      data: {
        measuredAt: shiftDate(today, -2),
        values: [{ metric: 'weight', value: '79', unit: 'kg' }],
        note: null,
      },
    },
  );
  expect(previous.ok()).toBe(true);

  const exercises = [
    { name: 'Synthetic exercise', sets: [{ reps: 8, weightKg: 20 }] },
  ];
  expect(
    (
      await page.request.post(`/api/workouts/plans?ownerId=${ownerId}`, {
        headers,
        data: {
          title: 'Synthetic plan',
          description: '',
          startsOn: today,
          endsOn: shiftDate(today, 1),
          workouts: [
            {
              id: `next-${info.project.name}`,
              title: 'Следующая тренировка',
              date: shiftDate(today, 1),
              exercises,
            },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post(`/api/workouts/sessions?ownerId=${ownerId}`, {
        headers,
        data: {
          title: 'Завершённая тренировка',
          date: today,
          exercises,
          status: 'completed',
          note: '',
        },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Питание сегодня' }).getByText('100,13'),
  ).toBeVisible();
  const data = await (
    await page.request.get(
      `/api/overview?timezone=${encodeURIComponent(timezone)}`,
    )
  ).json();
  expect(data.today).toBe(today);
  expect(data.nutrition.meanCalories).toBe('150.25');
  expect(data.nutrition.recordedDays).toBe(2);
  expect(data.nutrition.today.fat).toBeNull();
  expect(data.weight.points).toHaveLength(30);
  expect(data).toHaveProperty('sync');
  expect(data.workouts.planned.title).toBe('Следующая тренировка');
  expect(data.workouts.completed.title).toBe('Завершённая тренировка');
  await expect(
    page
      .getByRole('region', { name: 'Тренировки' })
      .getByText('Следующая тренировка', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Последние 7 дней' })
      .getByText('150,25 ккал'),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Открыть дневник', exact: true }),
  ).toHaveAttribute('href', `/diary?date=${today}`);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (process.env.OVERVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.OVERVIEW_SCREENSHOT_DIR}/overview-${info.project.name}-populated.png`,
      fullPage: true,
    });
  const trainers = await (
    await page.request.get(`/api/trainers?ownerId=${ownerId}`)
  ).json();
  const trainerId = trainers.find(
    (t: { email: string }) => t.email === 'trainer@example.test',
  ).id;
  const trainerContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    timezoneId: timezone,
  });
  const trainerPage = await trainerContext.newPage();
  await login(trainerPage, 'trainer');
  // Owner id is obtained from the actual signed-in session, never supplied to overview.

  expect(
    (
      await page.request.post('/api/trainers', { data: { ownerId, trainerId } })
    ).ok(),
  ).toBe(true);
  const granted = await trainerPage.request.get('/api/overview?timezone=UTC');
  expect(granted.status()).toBe(200);
  expect(await granted.json()).not.toHaveProperty('sync');
  await trainerPage.goto('/');
  await expect(
    trainerPage.getByText('Синхронизация дневника', { exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.delete('/api/trainers', {
        headers,
        data: { ownerId, trainerId },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await trainerPage.request.get('/api/overview?timezone=UTC')).status(),
  ).toBe(403);
  await trainerPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(trainerPage).toHaveURL('/login');
  await expect(
    trainerPage.getByRole('heading', { name: 'Обзор', exact: true }),
  ).not.toBeVisible();
  await trainerContext.close();
});
