import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '../ci/isolated-test';
import Database from 'better-sqlite3';
import { testOrigin, testUpstreamOrigin } from '../ci/origin';
import { getSessionWith429Retry } from '../e2e/auth-session';

async function control(request: APIRequestContext, action?: string) {
  const response = action
    ? await request.post(`${testUpstreamOrigin}/control`, { data: { action } })
    : await request.get(`${testUpstreamOrigin}/control`);
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    previewReads: number;
    previewActiveReads: number;
  };
}
async function login(page: Page, role = 'owner') {
  const send = () =>
    page.request.post('/api/auth/sign-in/email', {
      headers: { origin: testOrigin },
      data: {
        email: `${role}@example.test`,
        password: 'Test-only-password-12345',
      },
    });
  let response = await send();
  if (response.status() === 429) {
    const seconds = Number(
      response.headers()['retry-after'] ??
        response.headers()['x-retry-after'] ??
        10,
    );
    test.setTimeout(test.info().timeout + (seconds + 1) * 1000);
    await page.waitForTimeout((seconds + 1) * 1000);
    response = await send();
  }
  expect(response.status()).toBe(200);
  return (await getSessionWith429Retry(page.request)).user.id;
}
function fixture(owner: string, trainer?: string, enabled = false) {
  const db = new Database('.data/e2e.sqlite');
  try {
    expect(
      db.prepare('SELECT email FROM user WHERE id = ?').get(owner),
    ).toEqual({ email: 'owner@example.test' });
    if (trainer) {
      expect(
        db.prepare('SELECT email FROM user WHERE id = ?').get(trainer),
      ).toEqual({ email: 'trainer@example.test' });
      if (enabled)
        db.prepare(
          'INSERT OR IGNORE INTO trainer_access(owner_id,trainer_id,created_at) VALUES(?,?,?)',
        ).run(owner, trainer, Date.now());
      else
        db.prepare(
          'DELETE FROM trainer_access WHERE owner_id = ? AND trainer_id = ?',
        ).run(owner, trainer);
    } else
      db.prepare(
        'UPDATE transformmate_catalog_exercise SET detail = NULL, detail_fetched_at = NULL WHERE owner_id = ? AND exercise_id = 501',
      ).run(owner);
  } finally {
    db.close();
  }
}

test('owned preview negative requests coalesce across remounts, new revision retries once and revoked trainer cannot publish a late blob', async ({
  page,
  browser,
  request,
}) => {
  await control(request, 'reset');
  await control(request, 'previewold');
  const owner = await login(page);
  const connected = await page.request.post('/api/transformmate/connect', {
    headers: { origin: testOrigin },
    data: {
      apiKey: 'synthetic-api-key',
      refreshToken: 'synthetic-refresh-token',
    },
  });
  expect(connected.status()).toBe(200);
  fixture(owner);
  const detailPath = `/api/workouts/transformmate/exercises/501?ownerId=${owner}`;
  const previewPath = '/api/workouts/transformmate/exercises/501/preview';
  const oldDetail = (await (await page.request.get(detailPath)).json()).data;
  expect(oldDetail.preview.revision).toMatch(/^[a-f0-9]{64}$/);
  let ownGets = 0;
  const statuses: number[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === previewPath && r.method() === 'GET')
      ownGets++;
  });
  page.on('response', (r) => {
    if (new URL(r.url()).pathname === previewPath) statuses.push(r.status());
  });
  await page.goto('/workouts/new?date=2026-01-01');
  const input = page.getByRole('combobox', { name: 'Упражнение', exact: true });
  await input.fill('Demo');
  const option = page.getByRole('option', {
    name: 'Demo exercise',
    exact: true,
  });
  await expect(option).toBeVisible();
  await expect.poll(() => statuses).toEqual([404]);
  expect(ownGets).toBe(1);
  expect((await control(request)).previewReads).toBe(1);
  for (const query of ['Dem', 'De', 'Demo']) {
    await input.press('Escape');
    await input.click();
    await input.fill(query);
    await expect(option).toBeVisible();
  }
  const row = page.getByRole('region', { name: 'Упражнение · 1', exact: true });
  const groups = row.getByRole('combobox', {
    name: 'Группы мышц',
    exact: true,
  });
  // Close the exercise popover before targeting the filter underneath it.
  await input.press('Escape');
  await expect(option).not.toBeVisible();
  await groups.click();
  await page
    .getByRole('option', { name: 'Demo muscle group', exact: true })
    .click();
  await groups.press('Escape');
  await row
    .getByRole('button', { name: 'Сбросить фильтры', exact: true })
    .click();
  await input.click();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByTestId('exercise-details-501')).toContainText(
    'Demo description',
  );
  expect(ownGets).toBe(1);
  expect(statuses).toEqual([404]);
  expect((await control(request)).previewReads).toBe(1);
  await control(request, 'previewnew');
  fixture(owner);
  const newDetail = (await (await page.request.get(detailPath)).json()).data;
  expect(newDetail.preview.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(newDetail.preview.revision).not.toBe(oldDetail.preview.revision);
  await input.fill('Dem');
  await expect(option).toBeVisible();
  await expect.poll(() => statuses).toEqual([404, 200]);
  await expect(option.locator('img[src^="blob:"]')).toHaveCount(1);
  expect(ownGets).toBe(2);
  expect((await control(request)).previewReads).toBe(2);
  const context = await browser.newContext({
    baseURL: testOrigin,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  let trainerId: string | undefined;
  try {
    const trainer = await context.newPage();
    trainerId = await login(trainer, 'trainer');
    fixture(owner, trainerId, true);
    await control(request, 'previewdelay');
    await trainer.goto('/workouts/new?date=2026-01-01');
    const response = trainer.waitForResponse(
      (r) => new URL(r.url()).pathname === previewPath,
    );
    await trainer
      .getByRole('combobox', { name: 'Упражнение', exact: true })
      .fill('Demo');
    await expect
      .poll(async () => (await control(request)).previewActiveReads)
      .toBeGreaterThan(0);
    fixture(owner, trainerId, false);
    expect((await response).status()).toBe(403);
    await expect(
      trainer.locator('img[src^="blob:"], video[poster^="blob:"]'),
    ).toHaveCount(0);
    expect(
      (await trainer.request.get(`${previewPath}?ownerId=${owner}`)).status(),
    ).toBe(403);
  } finally {
    if (trainerId) fixture(owner, trainerId, false);
    await context.close();
    await control(request, 'reset');
  }
});
