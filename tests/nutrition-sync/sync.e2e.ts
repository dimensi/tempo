import { testOrigin } from '../ci/origin';
import { execFileSync } from 'node:child_process';
import { test, expect, type Page } from '../ci/isolated-test';
import {
  nutritionDaySchema,
  safeMealPhotoViewSchema,
  type SafeMealPhotoView,
} from '@/contracts/nutrition';
import type { SyncStatus } from '@/contracts/nutrition-sync';

const origin = testOrigin;
const date = '2026-01-01';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKxkAAAAASUVORK5CYII=',
  'base64',
);
function fixture(
  scenario: 'initial' | 'error' | 'image-error' | 'empty' | 'grant' | 'revoke',
) {
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
          UPLOADS_DIR: './.data/e2e-nutrition-uploads',
          BETTER_AUTH_URL: origin,
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
  const signedIn = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await signedIn).ok()).toBe(true);
  await expect(page).toHaveURL(origin + '/');
}
test('real owner/trainer sessions read durable sync snapshots and private photos, retain failed days, and enforce manage permissions', async ({
  page,
  browser,
  request,
}) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const initial = fixture('initial');
  expect(initial.status.state).toBe('completed');
  expect(initial.status.completedDates).toEqual([date, '2026-01-02']);
  const scope = `ownerId=${encodeURIComponent(initial.ownerId)}`;
  const dayUrl = `/api/nutrition/days/${date}?${scope}`;
  const photosUrl = `/api/nutrition/photos?${scope}&from=${date}&to=${date}`;
  const photoUrl = (id: string) =>
    `/api/nutrition/photos/${encodeURIComponent(id)}?${scope}`;
  expect((await request.get(dayUrl)).status()).toBe(401);
  await login(page, 'owner');
  await page.goto('/settings#connection');
  await expect(
    page.getByRole('heading', { name: 'Аккаунт YAZIO', level: 2, exact: true }),
  ).toBeVisible();
  expect((await page.request.get('/api/yazio/status')).status()).toBe(200);
  const dayResponse = await page.request.get(dayUrl);
  expect(dayResponse.ok()).toBe(true);
  const before = nutritionDaySchema.parse(await dayResponse.json());
  expect(before.meals[1]!.totals.calories).toBe('10');
  const daysResponse = await page.request.get(
    `/api/nutrition/days?${scope}&from=${date}&to=2026-01-02`,
  );
  expect(daysResponse.ok()).toBe(true);
  expect(await daysResponse.json()).toHaveLength(2);
  const initialPhotos = (await (
    await page.request.get(photosUrl)
  ).json()) as SafeMealPhotoView[];
  expect(initialPhotos).toHaveLength(1);
  expect(initialPhotos[0]!.source).toBe('yazio');
  expect(initialPhotos[0]).toEqual(
    safeMealPhotoViewSchema.parse(initialPhotos[0]),
  );
  const image = await page.request.get(photoUrl(initialPhotos[0]!.id));
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');
  expect(image.headers()['cache-control']).toBe('private, no-store');
  expect(image.headers()['x-content-type-options']).toBe('nosniff');
  expect(await image.body()).toEqual(png);
  expect((await request.get(photoUrl(initialPhotos[0]!.id))).status()).toBe(
    401,
  );
  expect(
    (
      await page.request.get(dayUrl.replace(scope, 'ownerId=another-owner'))
    ).status(),
  ).toBe(403);
  const upload = await page.request.post(
    `/api/nutrition/photos?${scope}&date=${date}&daytime=lunch`,
    { headers: { origin, 'content-type': 'image/png' }, data: png },
  );
  expect(upload.status()).toBe(201);
  const manual = safeMealPhotoViewSchema.parse(await upload.json());
  expect(manual.source).toBe('manual');
  let current = before;
  for (const scenario of ['error', 'image-error'] as const) {
    const expected =
      scenario === 'error'
        ? {
            state: 'failed',
            completedDates: [],
            skippedDates: [],
            failedDates: [date],
            photoFailedDates: [],
          }
        : {
            state: 'partial',
            completedDates: [date],
            skippedDates: [],
            failedDates: [],
            photoFailedDates: [date],
          };
    expect(fixture(scenario).status).toMatchObject(expected);
    await page.reload();
    expect(
      (await (await page.request.get('/api/yazio/status')).json()).sync,
    ).toMatchObject(expected);
    const updated = nutritionDaySchema.parse(
      await (await page.request.get(dayUrl)).json(),
    );
    if (scenario === 'error') expect(updated).toEqual(before);
    else {
      expect(updated.meals[1]!.totals.calories).toBe('20');
      expect(updated.meals[1]!.entries[0]!.amount).toBe('20');
      expect(Date.parse(updated.fetchedAt)).toBeGreaterThanOrEqual(
        Date.parse(before.fetchedAt),
      );
      current = updated;
    }
    expect(
      (
        (await (
          await page.request.get(photosUrl)
        ).json()) as SafeMealPhotoView[]
      )
        .map((p) => p.id)
        .sort(),
    ).toEqual([initialPhotos[0]!.id, manual.id].sort());
    expect(
      await (await page.request.get(photoUrl(initialPhotos[0]!.id))).body(),
    ).toEqual(png);
    expect(await (await page.request.get(photoUrl(manual.id))).body()).toEqual(
      png,
    );
  }
  const trainerContext = await browser.newContext();
  try {
    const trainer = await trainerContext.newPage();
    await login(trainer, 'trainer');
    expect((await trainer.request.get(dayUrl)).status()).toBe(403);
    fixture('grant');
    expect(await (await trainer.request.get(dayUrl)).json()).toEqual(current);
    expect((await trainer.request.get(photosUrl)).status()).toBe(200);
    expect(
      await (await trainer.request.get(photoUrl(manual.id))).body(),
    ).toEqual(png);
    expect((await trainer.request.get('/api/yazio/status')).status()).toBe(403);
    for (const path of ['/api/yazio/sync', '/api/yazio/token'])
      expect(
        (
          await trainer.request.post(path, { headers: { origin }, data: {} })
        ).status(),
      ).toBe(403);
    expect(
      (
        await trainer.request.post(
          `/api/nutrition/photos?${scope}&date=${date}&daytime=lunch`,
          { headers: { origin, 'content-type': 'image/png' }, data: png },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await trainer.request.delete(photoUrl(manual.id), {
          headers: { origin },
        })
      ).status(),
    ).toBe(403);
    fixture('revoke');
    expect((await trainer.request.get(dayUrl)).status()).toBe(403);
    expect((await trainer.request.get(photoUrl(manual.id))).status()).toBe(403);
  } finally {
    await trainerContext.close();
  }
  expect(fixture('empty').status.state).toBe('completed');
  await page.reload();
  expect(
    (await (await page.request.get('/api/yazio/status')).json()).sync.state,
  ).toBe('completed');
  const emptied = nutritionDaySchema.parse(
    await (await page.request.get(dayUrl)).json(),
  );
  expect(emptied.meals.flatMap((m) => m.entries)).toEqual([]);
  expect(await (await page.request.get(photosUrl)).json()).toEqual([manual]);
  expect(
    (await page.request.get(photoUrl(initialPhotos[0]!.id))).status(),
  ).toBe(404);
  expect(
    (
      await page.request.delete(photoUrl(manual.id), { headers: { origin } })
    ).status(),
  ).toBe(200);
  expect((await page.request.get(photoUrl(manual.id))).status()).toBe(404);
  expect(browserErrors).toEqual([]);
});
