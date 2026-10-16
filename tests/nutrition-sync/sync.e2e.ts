import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { nutritionDaySchema } from '@/contracts/nutrition';
import type { SyncStatus } from '@/contracts/nutrition-sync';
import { testOrigin } from '../smoke/origin';

const date = '2026-01-01';
function fixture(scenario: 'initial' | 'error') {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--conditions=react-server',
        '--import',
        'tsx',
        'tests/nutrition-sync/e2e-fixture.ts',
        scenario,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: 'file:./.data/e2e.sqlite',
          UPLOADS_DIR: './.data/e2e-uploads',
          BETTER_AUTH_URL: testOrigin,
          YAZIO_TOKEN_FILE: '',
        },
      },
    ),
  ) as { ownerId: string; status: SyncStatus };
}

async function login(page: Page, role: 'owner' | 'trainer') {
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill(`${role}@example.test`);
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL('/');
}

test('durable YAZIO data remains readable after a failed refresh and ungranted trainers cannot read it', async ({
  page,
  browser,
  request,
}) => {
  const initial = fixture('initial');
  const scope = `ownerId=${encodeURIComponent(initial.ownerId)}`;
  const dayUrl = `/api/nutrition/days/${date}?${scope}`;
  expect((await request.get(dayUrl)).status()).toBe(401);

  await login(page, 'owner');
  const before = nutritionDaySchema.parse(
    await (await page.request.get(dayUrl)).json(),
  );
  expect(before.meals[1]?.totals.calories).toBe('10');
  expect(fixture('error').status.state).toBe('failed');
  expect(
    nutritionDaySchema.parse(await (await page.request.get(dayUrl)).json()),
  ).toEqual(before);

  const trainerContext = await browser.newContext({
    baseURL: testOrigin,
    ignoreHTTPSErrors: true,
  });
  try {
    const trainer = await trainerContext.newPage();
    await login(trainer, 'trainer');
    expect((await trainer.request.get(dayUrl)).status()).toBe(403);
  } finally {
    await trainerContext.close();
  }
});
