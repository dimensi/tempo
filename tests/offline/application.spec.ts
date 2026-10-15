import { test, expect, type Page } from '../ci/isolated-test';
import Database from 'better-sqlite3';
import { build } from 'esbuild';
import { offlineFixture } from './fixtures';
import { shiftDate } from '../../src/contracts/nutrition-sync-dates';
// These fixtures seed calendar days with toISOString(), independent of host timezone.
test.use({ timezoneId: 'UTC' });
let harness: string;
test.beforeAll(async () => {
  harness = (
    await build({
      entryPoints: ['tests/offline/browser-harness.ts'],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      tsconfig: 'tsconfig.json',
    })
  ).outputFiles[0]!.text;
});
async function signIn(page: Page, role = 'owner') {
  const login = () =>
    page.request.post('/api/auth/sign-in/email', {
      headers: { origin: String(test.info().project.use.baseURL) },
      data: {
        email: `${role}@example.test`,
        password: 'Test-only-password-12345',
      },
    });
  let response = await login();
  if (response.status() === 429) {
    const seconds = Number(
      response.headers()['retry-after'] ??
        response.headers()['x-retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    response = await login();
  }
  expect(response.status()).toBe(200);
}
function seedReal() {
  const db = new Database('.data/e2e.sqlite');
  const owner = db
    .prepare('SELECT id FROM user WHERE email = ?')
    .get('owner@example.test') as { id: string };
  const date = new Date().toISOString().slice(0, 10);
  const old = shiftDate(date, -30);
  const fixture = offlineFixture(Date.now());
  const day = {
    ...fixture.diary[0]!,
    meals: fixture.diary[0]!.meals.map((meal) => ({
      ...meal,
      entries: meal.entries.map(({ key, ...entry }) => ({
        ...entry,
        id: key,
        sourceId: null,
        addedAt: null,
        consumedAt: null,
        editedAt: null,
      })),
    })),
  };
  db.prepare(
    'INSERT OR REPLACE INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES(?,?,?,?)',
  ).run(owner.id, date, JSON.stringify(day), new Date().toISOString());
  const exercises = [
    { name: 'Synthetic shared squat', sets: [{ reps: 8, weightKg: 0 }] },
  ];
  const session = (value: string) => ({
    date: value,
    title:
      value === date ? 'Synthetic ordinary result' : 'Synthetic older result',
    exercises,
    note: 'Literal result note',
    status: 'completed',
    planId: null,
    plannedWorkoutId: null,
    planSnapshot: null,
  });
  for (const [id, value] of [
    ['offline-real-session', date],
    ['offline-older-session', old],
  ])
    db.prepare(
      'INSERT OR REPLACE INTO workout_sessions(id,owner_id,date,data,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)',
    ).run(
      id,
      owner.id,
      value,
      JSON.stringify(session(value!)),
      new Date().toISOString(),
      new Date().toISOString(),
    );
  return { db, ownerId: owner.id, date, old };
}
async function waitSaved(page: Page) {
  await page.addScriptTag({ content: harness });
  await expect
    .poll(() => page.evaluate('window.offlineTest.read(Date.now())'))
    .toMatchObject({ present: true, enabled: true });
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => undefined),
  );
  if (
    !(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
  ) {
    await page.reload();
    await page.addScriptTag({ content: harness });
  }
}
async function openNavigation(page: Page) {
  const burger = page.getByRole('button', { name: 'Навигация', exact: true });
  if (await burger.isVisible()) await burger.click();
}
test('automatic cache reuses ordinary routes, cold reload, navigation and shared views without writes', async ({
  page,
  context,
}, info) => {
  const data = seedReal();
  try {
    await signIn(page);
    await page.goto(`/diary?date=${data.date}`);
    await waitSaved(page);
    await expect(
      page.getByText('Synthetic breakfast', { exact: true }),
    ).toBeVisible();
    await page.goto(
      `/workouts/sessions/offline-real-session?date=${data.date}`,
    );
    await expect(
      page.getByRole('heading', {
        name: 'Synthetic ordinary result',
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(
        async () => {
          await page.addScriptTag({ content: harness });
          return page.evaluate(async () => {
            const request = indexedDB.open('yazio-offline-read-v1', 3);
            return new Promise((resolve) => {
              request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('bundle');
                const read = tx.objectStore('bundle').get('current');
                read.onsuccess = () => {
                  resolve(
                    read.result?.snapshot.workoutSessions.some(
                      (item: { href: string }) =>
                        item.href === '/workouts/sessions/offline-real-session',
                    ),
                  );
                  db.close();
                };
              };
            });
          });
        },
        { timeout: 15000 },
      )
      .toBe(true);
    expect(
      await page.evaluate(
        async () =>
          (
            await fetch('/api/settings/steps-goal', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dailyStepsGoal: 12345 }),
            })
          ).status,
      ),
    ).toBe(200);
    await page.addScriptTag({ content: harness });
    await expect
      .poll(() => page.evaluate('window.offlineTest.savedGoal()'), {
        timeout: 15000,
      })
      .toBe(12345);
    await context.setOffline(true);
    // The already-open genuine Next route switches before any cold document fallback.
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Сеть или сервер недоступны · сохранённые данные' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Synthetic ordinary result',
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: 'К тренировкам', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/workouts\\?date=${data.date}`));
    await page
      .getByRole('link', { name: 'Открыть', exact: true })
      .and(page.locator('a[href^="/workouts/sessions/offline-real-session?"]'))
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/workouts/sessions/offline-real-session\\?date=${data.date}`),
    );
    await page.reload();
    await expect(
      page.getByRole('heading', {
        name: 'Synthetic ordinary result',
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: 'К тренировкам', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/workouts\\?date=${data.date}`));
    await expect(
      page.getByRole('heading', {
        name: 'Synthetic ordinary result',
        exact: true,
      }),
    ).toBeVisible();
    await openNavigation(page);
    await page
      .getByRole('link', { name: 'Дневник питания', exact: true })
      .click();
    await expect(
      page.getByText('Synthetic breakfast', { exact: true }),
    ).toBeVisible();
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.method() !== 'GET')
        writes.push(request.url());
    });
    const burger = page.getByRole('button', { name: 'Навигация', exact: true });
    if (await burger.isVisible())
      await expect(burger).toHaveAttribute('aria-expanded', 'false');
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark')
        await page
          .getByRole('button', { name: 'Переключить тему', exact: true })
          .click();
      await page.screenshot({
        path: info.outputPath(`offline-diary-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await expect(
      page.getByRole('button', { name: 'Обновить день', exact: true }),
    ).toBeDisabled();
    await page.goto(`/diary?date=${shiftDate(data.date, -15)}`);
    await expect(
      page.getByText('Нет сохранённых данных, нужна сеть', { exact: true }),
    ).toBeVisible();
    await page.goto(
      `/workouts/sessions/offline-real-session?date=${data.date}`,
    );
    await expect(
      page.getByRole('heading', {
        name: 'Synthetic ordinary result',
        exact: true,
      }),
    ).toBeVisible();
    for (const label of ['Изменить', 'Результат', 'Копировать', 'Удалить'])
      await expect(
        page.getByRole('button', { name: label, exact: true }),
      ).toBeDisabled();
    await expect(page.locator('video')).toHaveCount(0);
    for (const theme of ['dark', 'light']) {
      if (theme === 'light')
        await page
          .getByRole('button', { name: 'Переключить тему', exact: true })
          .click();
      await page.screenshot({
        path: info.outputPath(`offline-workout-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }

    await page.goto(`/workouts/native/987654?date=${data.date}`);
    await expect(
      page.getByText('Нет сохранённых данных, нужна сеть', { exact: true }),
    ).toBeVisible();
    await openNavigation(page);
    await page.getByRole('link', { name: 'Настройки', exact: true }).click();
    await expect(
      page.getByLabel('Часовой пояс', { exact: true }),
    ).toBeDisabled();
    await expect(page.getByLabel('Цель шагов', { exact: true })).toHaveValue(
      '12345',
    );
    expect(writes).toEqual([]);
    data.db
      .prepare('UPDATE session SET expires_at=0 WHERE user_id=?')
      .run(data.ownerId);
    await context.setOffline(false);
    await expect(page).toHaveURL(/\/login$/, { timeout: 15000 });
    await page.addScriptTag({ content: harness });
    await expect
      .poll(() => page.evaluate('window.offlineTest.rawCounts()'))
      .toEqual({ bundle: 0, photos: 0 });
    await signIn(page, 'trainer');
    expect((await page.request.get('/api/offline/identity')).status()).toBe(
      403,
    );
  } finally {
    await context.setOffline(false);
    data.db
      .prepare('DELETE FROM nutrition_days WHERE owner_id=? AND date=?')
      .run(data.ownerId, data.date);
    data.db
      .prepare('DELETE FROM owner_settings WHERE owner_id=?')
      .run(data.ownerId);
    data.db
      .prepare('DELETE FROM workout_sessions WHERE id IN (?,?)')
      .run('offline-real-session', 'offline-older-session');
    data.db.close();
  }
});
test('automatic activation waits for pending auth or provider mutation across tabs', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.addScriptTag({ content: harness });
  await page.evaluate('window.offlineTest.startMutation()');
  await expect
    .poll(() => page.evaluate('window.offlineTest.enteredMutation()'))
    .toBe(true);
  const sibling = await context.newPage();
  await signIn(sibling);
  await sibling.goto('/settings#offline');
  await sibling.addScriptTag({ content: harness });
  await expect
    .poll(() => sibling.evaluate('window.offlineTest.read(Date.now())'))
    .toEqual({ present: false, photos: 0, enabled: false });
  await page.evaluate('window.offlineTest.finishMutation()');
  await sibling.evaluate(() => window.dispatchEvent(new Event('focus')));
  await waitSaved(sibling);
});

test('refill holds a shared lock past advisory-check gap and cannot publish during a held provider request', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.addScriptTag({ content: harness });
  const provider = await context.newPage();
  await provider.goto('/login');
  await provider.addScriptTag({ content: harness });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await provider.route('**/api/transformmate/connect', async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });
  await page.evaluate('window.offlineTest.startRefillRace()');
  await expect
    .poll(() => page.evaluate('window.offlineTest.raceState().entered'))
    .toBe(true);
  expect(
    await page.evaluate(async () =>
      (await navigator.locks.query()).held?.some(
        (lock) =>
          lock.name === 'yazio-offline-mutation' && lock.mode === 'shared',
      ),
    ),
  ).toBe(true);
  await provider.evaluate('window.offlineTest.startHeldProvider()');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).some((key) =>
          key.startsWith('yazio.offline.intent:'),
        ),
      ),
    )
    .toBe(true);
  expect(
    await provider.evaluate('window.offlineTest.heldProviderEntered()'),
  ).toBe(false);
  await page.evaluate('window.offlineTest.releaseRefillIdentity()');
  await page.evaluate('window.offlineTest.waitRefill()');
  await expect
    .poll(() => provider.evaluate('window.offlineTest.heldProviderEntered()'))
    .toBe(true);
  expect(await page.evaluate('window.offlineTest.raceState()')).toMatchObject({
    commits: 0,
    published: [],
  });
  await expect(page.getByTestId('race-private')).toBeHidden();
  const before = Number(
    await page.evaluate('window.offlineTest.raceState().requests'),
  );
  await page.evaluate('window.offlineTest.retryRefill()');
  expect(await page.evaluate('window.offlineTest.raceState()')).toMatchObject({
    commits: 0,
    published: [],
    requests: before,
  }); // ifAvailable skips rather than queues.
  release();
  expect(
    await provider.evaluate('window.offlineTest.finishHeldProvider()'),
  ).toBe(200);
  await page.evaluate('window.offlineTest.setRaceGeneration()');
  await page.evaluate('window.offlineTest.retryRefill()');
  expect(await page.evaluate('window.offlineTest.raceState()')).toMatchObject({
    commits: 1,
    published: ['Z'.repeat(43)],
    status: 'ready',
  });
  await expect(page.getByTestId('race-private')).toBeVisible();
  expect(await page.evaluate('window.offlineTest.cacheWithoutLocks()')).toEqual(
    { requests: 0, status: 'error', error: 'unavailable', bundle: null },
  );
});

test('old workout detail bookmark without a query does not bypass the rolling retention window', async ({
  page,
  context,
}) => {
  const data = seedReal();
  try {
    await signIn(page);
    await page.goto('/workouts/sessions/offline-older-session');
    await expect(
      page.getByRole('heading', {
        name: 'Synthetic older result',
        exact: true,
      }),
    ).toBeVisible();
    await waitSaved(page);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const request = indexedDB.open('yazio-offline-read-v1', 3);
          return new Promise((resolve) => {
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction('bundle');
              const read = tx.objectStore('bundle').get('current');
              read.onsuccess = () => {
                resolve(
                  read.result?.snapshot.workoutSessions.some(
                    (item: { href: string }) =>
                      item.href === '/workouts/sessions/offline-older-session',
                  ),
                );
                db.close();
              };
            };
          });
        }),
      )
      .toBe(false);
    await context.setOffline(true);
    await page.reload();
    await expect(page).toHaveURL('/workouts/sessions/offline-older-session');
    await expect(
      page.getByText('Нет сохранённых данных, нужна сеть', { exact: true }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
    data.db
      .prepare('DELETE FROM nutrition_days WHERE owner_id=? AND date=?')
      .run(data.ownerId, data.date);
    data.db
      .prepare('DELETE FROM workout_sessions WHERE id IN (?,?)')
      .run('offline-real-session', 'offline-older-session');
    data.db.close();
  }
});

test('linked TransformMate literal facts remain visible exactly once in plan day and deep detail', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.addScriptTag({ content: harness });
  await page.evaluate('window.offlineTest.seed(\u0027linked-plan\u0027)');
  await page.evaluate('window.offlineTest.prepareShell()');
  const date = new Date().toISOString().slice(0, 10);
  await context.setOffline(true);
  try {
    await page.goto(`/workouts?date=${date}`);
    await expect(page.getByText('Weight: 0 кг', { exact: true })).toHaveCount(
      1,
    );
    await expect(
      page.getByText('Duration: 01–03 мин', { exact: true }),
    ).toHaveCount(1);
    await page.goto(
      `/workouts/plans/synthetic-plan/workouts/synthetic-workout?date=${date}`,
    );
    await expect(page.getByText('Weight: 0 кг', { exact: true })).toHaveCount(
      1,
    );
    await page.addScriptTag({ content: harness });
    await page.evaluate('window.offlineTest.removeLinkedNative()');
    await page.reload();
    await expect(
      page.getByText('Synthetic movement', { exact: true }),
    ).toHaveCount(1);
    await page.goto(`/workouts?date=${date}`);
    await expect(
      page.getByText('Synthetic movement', { exact: true }),
    ).toHaveCount(1);
  } finally {
    await context.setOffline(false);
  }
});

test('owner results and manual measurements survive offline tab closure and synchronize once across two tabs', async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.goto('/workouts');
  await waitSaved(page);
  const identity = await page.request.get('/api/auth/get-session');
  const ownerId = (await identity.json()).user.id as string;
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const request = indexedDB.open('yazio-offline-writes-v1', 1);
              request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('state', 'readonly');
                const get = tx.objectStore('state').get('current');
                get.onsuccess = () => resolve(Boolean(get.result?.partition));
                tx.oncomplete = () => db.close();
              };
            }),
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  const name = `Offline durable ${test.info().project.name}`;
  await context.setOffline(true);
  await page.goto('/workouts');
  let panel = page.locator('[data-offline-write-private]');
  await panel
    .getByRole('button', { name: 'Записать тренировку', exact: true })
    .click();
  await panel.getByLabel('Упражнение').fill(name);
  await panel.getByLabel('Вес, кг', { exact: true }).fill('42.5');
  await panel.getByLabel('Повторения', { exact: true }).fill('9');
  await panel
    .getByRole('button', { name: 'Сохранить на устройстве', exact: true })
    .click();
  await expect(
    panel.getByText('Сохранено на устройстве', { exact: true }),
  ).toBeVisible();
  await page.goto('/measurements');
  panel = page.locator('[data-offline-write-private]');
  await panel
    .getByRole('button', { name: 'Записать замер', exact: true })
    .click();
  await panel.getByLabel('Вес, кг', { exact: true }).fill('73.25');
  await panel.getByLabel('Заметка', { exact: true }).fill(name);
  await panel
    .getByRole('button', { name: 'Сохранить на устройстве', exact: true })
    .click();
  await expect(
    panel.getByText('Сохранено на устройстве', { exact: true }),
  ).toBeVisible();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/workouts');
  await expect(reopened.locator('[data-offline-write-private]')).toContainText(
    name,
  );
  await expect(reopened.locator('[data-offline-write-private]')).toContainText(
    '42.5 × 9',
  );
  const second = await context.newPage();
  await second.goto('/measurements');
  await expect(second.locator('[data-offline-write-private]')).toContainText(
    '73.25',
  );
  await expect(
    second.getByText('Сохранено на устройстве', { exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(
      async () => {
        const sessions = await reopened.request.get(
          `/api/workouts?ownerId=${ownerId}`,
        );
        return (await sessions.json()).data.sessions.filter(
          (item: { exercises: { name: string }[] }) =>
            item.exercises.some((exercise) => exercise.name === name),
        ).length;
      },
      { timeout: 45000 },
    )
    .toBe(1);
  await expect
    .poll(
      async () => {
        const measurements = await reopened.request.get(
          `/api/measurements?ownerId=${ownerId}`,
        );
        return (await measurements.json()).filter(
          (item: { note: string | null }) => item.note === name,
        ).length;
      },
      { timeout: 45000 },
    )
    .toBe(1);
  // Reconnection already navigates both offline shells back to the live app.
  // Observe the acknowledgement without racing that navigation with another load.
  await expect(
    reopened
      .locator('[data-offline-write-private]')
      .getByText('Синхронизировано', { exact: true }),
  ).toBeVisible();
  await expect(
    second
      .locator('[data-offline-write-private]')
      .getByText('Синхронизировано', { exact: true }),
  ).toBeVisible();
});

test('saved sections show ordinary content and the complete report without network requests', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.addScriptTag({ content: harness });
  await page.evaluate("window.offlineTest.seed('sections')");
  await page.evaluate('window.offlineTest.prepareShell()');
  const failures: string[] = [];
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/'))
      apiRequests.push(request.url());
  });
  page.on('pageerror', (error) => failures.push(error.message));
  await context.setOffline(true);
  try {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Питание сегодня', exact: true }),
    ).toBeVisible();
    await page.goto('/analytics');
    await expect(
      page.getByRole('button', { name: '30 дней', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '30 дней', exact: true }).click();
    await expect(page).toHaveURL(/from=/);
    await page.goto('/measurements');
    await expect(
      page.getByRole('cell', { name: 'Synthetic manual', exact: true }),
    ).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByLabel('Часовой пояс', { exact: true })).toHaveValue(
      'UTC',
    );
    await expect(
      page.getByLabel('Часовой пояс', { exact: true }),
    ).toBeDisabled();
    await expect(page.getByLabel('Цель шагов', { exact: true })).toHaveValue(
      '10000',
    );
    await expect(page.getByLabel('Цель шагов', { exact: true })).toBeDisabled();
    const date = new Date().toISOString().slice(0, 10);
    await page.goto(`/diary?date=${date}`);
    await expect(
      page.getByText('Saved offline comment', { exact: true }),
    ).toBeVisible();
    await page.goto('/workouts/catalog');
    await expect(
      page.getByText('Saved catalog exercise', { exact: true }),
    ).toBeVisible();
    await page.goto('/reports');
    await expect(
      page
        .frameLocator('iframe')
        .getByText('Synthetic breakfast', { exact: true }),
    ).toBeVisible();
    expect(failures).toEqual([]);
    expect(apiRequests).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});
