import { expect, test, type Page } from '@playwright/test';
import { testOrigin } from './origin';
import type { Workout } from '@/contracts/workouts';

async function cachedReadBody(page: Page, expectedTitle: string) {
  return page.evaluate(async (title) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('yazio-offline-read-v1');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const read = database
          .transaction('resources')
          .objectStore('resources')
          .getAll();
        read.onsuccess = () => {
          const body = read.result.find((row) => {
            if (typeof row.record?.body !== 'string') return false;
            const data = JSON.parse(row.record.body).data;
            return (
              Array.isArray(data?.workouts) &&
              data.workouts.some((item: Workout) => item.title === title)
            );
          })?.record?.body;
          if (typeof body === 'string') resolve(body);
          else reject(new Error('Cached workout is missing'));
        };
        read.onerror = () => reject(read.error);
      });
    } finally {
      database.close();
    }
  }, expectedTitle);
}

test('real login reaches core sections, recovers a cached workout offline, purges logout data, and authorizes trainer offline edits', async ({
  page,
  context,
  request,
}) => {
  expect((await request.get('/api/workouts?ownerId=unknown')).status()).toBe(
    401,
  );
  expect(
    (
      await request.get(
        '/api/workouts/transformmate/exercises/501?ownerId=unknown',
      )
    ).status(),
  ).toBe(401);
  await page.route('**/api/workouts/transformmate/exercises/501?*', (route) =>
    route.fulfill({
      json: {
        data: {
          id: 501,
          name: 'Downloaded technique',
          description: 'Synthetic technique instructions',
          canPlan: true,
          hasVideo: true,
          publicationCapability: { state: 'supported', reason: null },
          snippet: null,
          preview: { coverage: 'absent', path: null, revision: 'a'.repeat(64) },
          detailCoverage: 'available',
          membershipCoverage: 'available',
          muscleGroups: [],
          muscles: [],
          fetchedAt: new Date().toISOString(),
          detailFetchedAt: new Date().toISOString(),
          stale: false,
        },
      },
    }),
  );
  await page.goto('/workouts/catalog/501');
  await expect(page).toHaveURL('/login?returnTo=%2Fworkouts%2Fcatalog%2F501');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  const login = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL('/workouts/catalog/501');
  await expect(
    page.getByRole('heading', { name: 'Downloaded technique', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Synthetic technique instructions', { exact: true }),
  ).toBeVisible();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page
    .getByRole('button', { name: 'Скопировать ссылку', exact: true })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Ссылка скопирована' }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `${testOrigin}/workouts/catalog/501`,
  );
  // A broken clipboard still leaves a usable, selectable URL.
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: () => Promise.reject(new Error('Unavailable')),
    });
  });
  await page
    .getByRole('button', { name: 'Скопировать ссылку', exact: true })
    .click();
  await expect(page.getByLabel('Скопируйте ссылку вручную')).toHaveValue(
    `${testOrigin}/workouts/catalog/501`,
  );
  await page.route('**/api/workouts/transformmate/exercises?*', (route) =>
    route.fulfill({
      json: {
        contractVersion: 1,
        source: 'user',
        data: [
          {
            id: 501,
            name: 'Downloaded technique',
            canPlan: true,
            publicationCapability: { state: 'supported', reason: null },
            snippet: null,
            preview: {
              coverage: 'absent',
              path: null,
              revision: 'a'.repeat(64),
            },
            detailCoverage: 'available',
            membershipCoverage: 'available',
            muscleGroups: [],
            fetchedAt: new Date().toISOString(),
            detailFetchedAt: new Date().toISOString(),
          },
        ],
        catalog: {
          fetchedAt: new Date().toISOString(),
          stale: false,
          coverage: 'complete',
          refreshState: 'idle',
          total: 1,
          hasMore: false,
          unknownMembershipCount: 0,
          filters: {
            query: '',
            commonMuscleGroup: null,
            muscleGroups: [],
            offset: 0,
            limit: 12,
          },
        },
      },
    }),
  );
  await page
    .getByRole('navigation', { name: 'Навигация', exact: true })
    .first()
    .getByRole('link', { name: 'Каталог упражнений', exact: true })
    .click();
  await expect(page).toHaveURL('/workouts/catalog');
  const sidebar = page
    .getByRole('navigation', { name: 'Навигация', exact: true })
    .first();
  await expect(
    sidebar.getByRole('link', { name: 'Каталог упражнений', exact: true }),
  ).toHaveAttribute('data-active', 'true');
  await expect(
    sidebar.getByRole('link', { name: 'Тренировки', exact: true }),
  ).not.toHaveAttribute('data-active', 'true');
  await expect(
    page.getByRole('link', { name: 'Downloaded technique', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Скопировать ссылку: Downloaded technique',
      exact: true,
    })
    .click();
  await expect(page.getByLabel('Скопируйте ссылку вручную')).toHaveValue(
    `${testOrigin}/workouts/catalog/501`,
  );
  await page
    .getByRole('link', { name: 'Downloaded technique', exact: true })
    .click();
  await expect(page).toHaveURL('/workouts/catalog/501');
  await page.goto('/more');
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Каталог упражнений', exact: true })
    .click();
  await expect(page).toHaveURL('/workouts/catalog');
  await page.unroute('**/api/workouts/transformmate/exercises?*');
  const owner = (await (await page.request.get('/api/auth/get-session')).json())
    .user.id as string;
  for (const route of [
    '/',
    '/measurements',
    '/analytics',
    '/reports',
    '/settings',
  ])
    expect((await page.goto(route))?.ok()).toBe(true);

  const chartErrors: string[] = [];
  const captureChartError = (error: Error) => chartErrors.push(error.message);
  page.on('pageerror', captureChartError);
  const measurement = await page.request.post(
    `/api/measurements?ownerId=${owner}`,
    {
      headers: { Origin: testOrigin },
      data: {
        measuredAt: '2026-10-01',
        note: 'Synthetic chart smoke',
        values: [
          { metric: 'weight', value: '75', unit: 'kg' },
          { metric: 'waist', value: '80', unit: 'cm' },
        ],
      },
    },
  );
  expect(measurement.status()).toBe(201);
  await page.goto('/measurements');
  const chart = page.getByTestId('measurement-trend-chart');
  await expect(chart).toBeVisible();
  for (const metric of ['Вес', 'Талия']) {
    await page.getByRole('combobox', { name: 'Динамика', exact: true }).click();
    await page.getByRole('option', { name: metric, exact: true }).click();
    await chart.hover({ position: { x: 150, y: 120 } });
    await expect(chart.locator('.recharts-tooltip-wrapper')).toBeVisible();
    await expect(chart.locator('.recharts-tooltip-wrapper')).toContainText(
      '2026',
    );
    await expect(chart.locator('.recharts-tooltip-wrapper')).not.toContainText(
      '1970',
    );
    await page
      .getByRole('heading', { name: 'История замеров', exact: true })
      .hover();
    await expect(chart).toBeVisible();
  }
  expect(
    chartErrors.filter((message) => message.includes('Invalid time value')),
  ).toEqual([]);
  page.off('pageerror', captureChartError);

  await page.goto('/diary');
  await expect(
    page.getByRole('heading', { name: 'Дневник питания', exact: true }),
  ).toBeVisible();
  await page.goto('/workouts');
  await page.route('**/api/offline/writes', (route) =>
    route.request().method() === 'POST' ? route.abort() : route.continue(),
  );
  await page
    .getByRole('button', { name: 'Создать тренировку', exact: true })
    .click();
  const title = 'Production smoke workout';
  const titleInput = page.getByRole('textbox', {
    name: 'Название тренировки',
    exact: true,
  });
  const note = page.getByLabel('Заметка к тренировке', { exact: true });
  const firstWeight = page.getByLabel('Smoke squat, Подход 1, Вес, кг', {
    exact: true,
  });
  const firstReps = page.getByLabel('Smoke squat, Подход 1, Повторения', {
    exact: true,
  });
  const readWorkout = async () => {
    const response = await page.request.get(`/api/workouts?ownerId=${owner}`);
    expect(response.ok()).toBe(true);
    const body = await response.json();
    return (body.data.workouts as Workout[]).find(
      (item) => item.title === title,
    );
  };
  const fillPlan = async () => {
    await titleInput.fill(title);
    await note.fill('Planned note');
    await page
      .getByRole('button', { name: 'Добавить упражнения', exact: true })
      .click();
    await page
      .getByRole('textbox', { name: 'Поиск по названию', exact: true })
      .fill('Smoke squat');
    await page
      .getByRole('button', {
        name: 'Добавить вручную: Smoke squat',
        exact: true,
      })
      .click();
    await firstWeight.fill('20');
    await firstReps.fill('10');
    await expect
      .poll(async () => {
        const workout = await readWorkout();
        return (
          workout && {
            status: workout.status,
            note: workout.note,
            sets: workout.exercises[0]?.sets,
          }
        );
      })
      .toEqual({
        status: 'planned',
        note: 'Planned note',
        sets: [{ weightKg: 20, reps: 10 }],
      });
  };
  // An unacknowledged new workout must remain recoverable through the create flow.
  await titleInput.fill('Queued new workout');
  await note.fill('Unacknowledged draft');
  await expect(
    page.getByText(
      'Результаты сохранены на устройстве и отправятся при подключении.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.goto('/diary');
  await page.goto('/workouts');
  await page
    .getByRole('button', { name: 'Создать тренировку', exact: true })
    .click();
  await expect(titleInput).toHaveValue('Queued new workout');
  await expect(note).toHaveValue('Unacknowledged draft');
  await page.unroute('**/api/offline/writes');
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        const response = await page.request.get(
          `/api/workouts?ownerId=${owner}`,
        );
        return ((await response.json()).data.workouts as Workout[]).some(
          (item) => item.title === 'Queued new workout',
        );
      },
      { timeout: 10000 },
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter(
            (key) =>
              key.startsWith('workout-draft:') && key.includes(':day:new:'),
          ).length,
      ),
    )
    .toBe(0);
  const queued = (
    (await (await page.request.get(`/api/workouts?ownerId=${owner}`)).json())
      .data.workouts as Workout[]
  ).find((item) => item.title === 'Queued new workout')!;
  await page.goto('/diary');
  expect(
    (
      await page.request.delete(`/api/workouts/${queued.id}`, {
        headers: { Origin: testOrigin },
        data: { ownerId: owner, revision: queued.revision },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/workouts');
  await page
    .getByRole('button', { name: 'Создать тренировку', exact: true })
    .click();
  await expect(titleInput).toHaveValue('');
  await expect(note).toHaveValue('');
  await fillPlan();
  // Delete directly from the still-mounted creation editor. A delayed/stale
  // list response must not keep the deleted editor visible until date navigation.
  const oldList = await (
    await page.request.get(`/api/workouts?ownerId=${owner}`)
  ).json();
  const releaseDeleteRefresh = Promise.withResolvers<void>();
  await page.route('**/api/workouts?*', async (route) => {
    await releaseDeleteRefresh.promise;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(oldList),
    });
  });
  try {
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Действия с тренировкой', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Удалить тренировку', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Подтвердить удаление', exact: true })
      .getByRole('button', { name: 'Удалить', exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: 'На этот день тренировок нет',
        exact: true,
      }),
    ).toBeVisible();
    await expect(titleInput).toHaveCount(0);
    expect(await readWorkout()).toBeUndefined();
  } finally {
    releaseDeleteRefresh.resolve();
    await page.unroute('**/api/workouts?*');
  }
  await page
    .getByRole('button', { name: 'Создать тренировку', exact: true })
    .click();
  await fillPlan();
  const planned = (await readWorkout())!;
  await expect(
    page.getByRole('radiogroup', { name: 'Тренировка дня' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Скачать тренировку', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Завершить', exact: true }),
  ).toBeVisible();
  await expect(firstWeight).toHaveValue('20');
  await expect(firstReps).toHaveValue('10');
  const started = (await readWorkout())!;
  expect(started).toMatchObject({
    id: planned.id,
    title,
    note: planned.note,
    status: 'in_progress',
    exercises: planned.exercises,
  });

  const feedbackWrite = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/offline/writes') &&
      request.method() === 'POST' &&
      request.postDataJSON().payload.feedback?.fatigue === 6,
  );
  await page
    .getByLabel('Smoke squat, Утомляемость, 1–10', { exact: true })
    .selectOption('6');
  expect((await feedbackWrite).postDataJSON().payload.feedback).toMatchObject({
    fatigue: 6,
    failure: null,
  });
  await expect
    .poll(async () => (await readWorkout())?.exercises[0]?.fatigue)
    .toBe(6);

  // Acknowledging an older save must preserve a newer live input and its position.
  const releaseWrite = Promise.withResolvers<void>();
  let delayed = false;
  await page.route('**/api/offline/writes', async (route) => {
    if (route.request().method() === 'POST' && !delayed) {
      delayed = true;
      await releaseWrite.promise;
    }
    await route.continue();
  });
  await note.fill('First note');
  await expect.poll(() => delayed).toBe(true);
  await expect(note).toBeFocused();
  await expect(note).toBeEditable();
  const noteTop = await note.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await note.fill('Final note');
  // Cross the debounce while the first write remains in flight.
  await page.waitForTimeout(1300);
  releaseWrite.resolve();
  await expect.poll(async () => (await readWorkout())?.note).toBe('Final note');
  await expect(note).toHaveValue('Final note');
  await expect(note).toBeFocused();
  expect(
    Math.abs(
      (await note.evaluate((element) => element.getBoundingClientRect().top)) -
        noteTop,
    ),
  ).toBeLessThan(1);
  await page.unroute('**/api/offline/writes');

  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Продолжить', exact: true }),
  ).toBeVisible();
  await expect(titleInput).toHaveAttribute('readonly', '');
  await expect(note).toHaveAttribute('readonly', '');
  await expect(firstReps).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Добавить подход', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Добавить упражнения', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Техника: Smoke squat', exact: true }),
  ).toBeVisible();
  const fatigue = page.getByLabel('Smoke squat, Утомляемость, 1–10', {
    exact: true,
  });
  const failure = page.getByLabel('Smoke squat, Был отказ?', { exact: true });
  await fatigue.selectOption('8');
  await failure.selectOption('partial');
  await expect
    .poll(async () => (await readWorkout())?.exercises[0]?.fatigue)
    .toBe(8);
  expect((await readWorkout())?.exercises[0]?.failure).toBe('partial');
  const completed = (await readWorkout())!;
  expect(completed.status).toBe('completed');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(firstReps).toHaveValue('10');
  await expect(firstWeight).toHaveValue('20');
  await expect(note).toHaveValue('Final note');
  await expect(titleInput).toBeEditable();
  expect((await readWorkout())?.exercises).toEqual(completed.exercises);

  // An incomplete set remains a local draft across ordinary navigation.
  await page
    .getByRole('button', { name: 'Добавить подход', exact: true })
    .press('Enter');
  const secondWeight = page.getByLabel('Smoke squat, Подход 2, Вес, кг', {
    exact: true,
  });
  const secondReps = page.getByLabel('Smoke squat, Подход 2, Повторения', {
    exact: true,
  });
  await expect(secondWeight).toBeFocused();
  await expect(secondWeight).toHaveValue('20');
  await expect(secondReps).toHaveValue('10');
  await secondReps.fill('');
  await secondWeight.fill('25');
  await firstReps.fill('');
  await note.fill('Note with unfinished sets');
  await expect
    .poll(async () => (await readWorkout())?.note)
    .toBe('Note with unfinished sets');
  expect((await readWorkout())?.exercises[0]?.sets).toEqual([
    { weightKg: 20, reps: 10 },
    { weightKg: 20, reps: 10 },
  ]);
  await expect(firstReps).toHaveValue('');
  await expect(firstReps).not.toHaveAttribute('aria-invalid', 'true');
  await expect(secondReps).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByText('Есть незаконченный ввод', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await expect(firstReps).toHaveAttribute('aria-invalid', 'true');
  await expect(secondReps).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect((await readWorkout())?.status).toBe('in_progress');
  const dayUrl = page.url();
  await page.goto('/diary');
  await page.goto(dayUrl);
  await expect(secondWeight).toHaveValue('25');
  await expect(secondReps).toHaveValue('');
  await expect(firstReps).toHaveValue('');
  await firstReps.fill('10');
  await secondReps.fill('8');
  await expect
    .poll(async () => (await readWorkout())?.exercises[0]?.sets[1])
    .toEqual({ reps: 8, weightKg: 25 });
  await page
    .getByRole('button', { name: 'Добавить подход', exact: true })
    .press('Enter');
  const thirdWeight = page.getByLabel('Smoke squat, Подход 3, Вес, кг', {
    exact: true,
  });
  await expect(thirdWeight).toBeFocused();
  await expect(thirdWeight).toHaveValue('25');
  await expect(
    page.getByLabel('Smoke squat, Подход 3, Повторения', { exact: true }),
  ).toHaveValue('8');
  await page
    .getByRole('button', { name: 'Удалить подход 3: Smoke squat', exact: true })
    .click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  const acknowledgedRevision = (await readWorkout())!.revision;

  // A loaded resource renders immediately while a refresh is stalled.
  await expect
    .poll(async () => {
      const body = JSON.parse(await cachedReadBody(page, title));
      return (body.data.workouts as Workout[]).find(
        (item) => item.title === title,
      )?.revision;
    })
    .toBe(acknowledgedRevision);
  const cachedWorkout = await cachedReadBody(page, title);
  const releaseRead = Promise.withResolvers<void>();
  let readStarted = false;
  const readFinished = Promise.withResolvers<void>();
  await page.route('**/api/workouts?*', async (route) => {
    readStarted = true;
    await releaseRead.promise;
    await route.fulfill({
      contentType: 'application/json',
      body: cachedWorkout,
    });
    readFinished.resolve();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => readStarted).toBe(true);
  await expect(
    page.getByRole('button', { name: 'Техника: Smoke squat', exact: true }),
  ).toBeVisible();
  releaseRead.resolve();
  await readFinished.promise;
  await page.unroute('**/api/workouts?*');
  // Returning to an acknowledged draft must not enqueue an unchanged update.
  await page.waitForTimeout(1400);
  expect((await readWorkout())?.revision).toBe(acknowledgedRevision);

  // Pending writes survive a logout attempt until the owner chooses what to do.
  await context.setOffline(true);
  await page
    .getByRole('button', { name: 'Добавить упражнения', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Поиск по названию', exact: true })
    .fill('Queued exercise');
  await page
    .getByRole('button', {
      name: 'Добавить вручную: Queued exercise',
      exact: true,
    })
    .click();
  await fatigue.selectOption('7');
  await note.fill('Saved while offline');
  await expect(
    page.getByText(
      'Результаты сохранены на устройстве и отправятся при подключении.',
      { exact: true },
    ),
  ).toBeVisible();
  // Pending operations also protect deletion when transport fails but the browser is online.
  await page.route('**/api/offline/writes', (route) => route.abort());
  await context.setOffline(false);
  await page
    .getByRole('button', { name: 'Действия с тренировкой', exact: true })
    .click();
  await expect(
    page.getByRole('menuitem', { name: 'Удалить тренировку', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', {
      name: 'Действия с упражнением: Smoke squat',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('menuitem', { name: 'Удалить упражнение', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await context.setOffline(true);
  await page.unroute('**/api/offline/writes');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Есть несинхронизированные записи',
  );
  await expect(note).toHaveValue('Saved while offline');
  expect(
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('yazio-offline-writes-v1');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        return await new Promise<boolean>((resolve, reject) => {
          const read = database
            .transaction('state')
            .objectStore('state')
            .get('current');
          read.onsuccess = () =>
            resolve(
              read.result.operations.some(
                (entry: {
                  status: string;
                  operation: {
                    payload: { kind: string; data: { note: string } };
                  };
                }) =>
                  entry.status !== 'synced' &&
                  entry.operation.payload.kind === 'workout' &&
                  entry.operation.payload.data.note === 'Saved while offline',
              ),
            );
          read.onerror = () => reject(read.error);
        });
      } finally {
        database.close();
      }
    }),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Остаться и синхронизировать', exact: true })
    .click();
  await context.setOffline(false);
  await expect
    .poll(async () => (await readWorkout())?.note)
    .toBe('Saved while offline');
  expect((await readWorkout())?.exercises[0]?.fatigue).toBe(7);
  expect((await readWorkout())?.exercises[0]?.failure).toBe('partial');
  // The background acknowledgement supplies the revision for the next edit.
  await note.fill('Saved after reconnect');
  await expect
    .poll(async () => (await readWorkout())?.note)
    .toBe('Saved after reconnect');

  await page.goto('/diary');
  const navigation = page.getByRole('button', {
    name: 'Навигация',
    exact: true,
  });
  if (await navigation.isVisible()) await navigation.click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/login');
  expect(
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('yazio-offline-read-v1');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        return await new Promise<boolean>((resolve) => {
          const tx = database.transaction(['resources', 'files', 'metadata']);
          let remaining = 3;
          let empty = true;
          for (const name of ['resources', 'files', 'metadata']) {
            const count = tx.objectStore(name).count();
            count.onsuccess = () => {
              empty &&= count.result === 0;
              if (--remaining === 0) resolve(empty);
            };
          }
        });
      } finally {
        database.close();
      }
    }),
  ).toBe(true);
  expect(
    (await page.request.get(`/api/workouts?ownerId=${owner}`)).status(),
  ).toBe(401);

  const trainerLogin = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: testOrigin },
    data: {
      email: 'trainer@example.test',
      password: 'Test-only-password-12345',
    },
  });
  expect(trainerLogin.status()).toBe(200);
  expect(
    (await page.request.get(`/api/workouts?ownerId=${owner}`)).status(),
  ).toBe(403);
  expect(
    (
      await page.request.get(
        `/api/workouts/transformmate/exercises/501?ownerId=${owner}`,
      )
    ).status(),
  ).toBe(403);

  const trainer = (
    await (await page.request.get('/api/auth/get-session')).json()
  ).user.id as string;
  expect(
    (
      await request.post('/api/auth/sign-in/email', {
        headers: { origin: testOrigin },
        data: {
          email: 'owner@example.test',
          password: 'Test-only-password-12345',
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post('/api/trainers', {
        headers: { Origin: testOrigin },
        data: { ownerId: owner, trainerId: trainer },
      })
    ).ok(),
  ).toBe(true);

  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    Object.assign(window, { workoutRevisionEvents: 0 });
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        this.addEventListener('revision', () => {
          const state = window as typeof window & {
            workoutRevisionEvents: number;
          };
          state.workoutRevisionEvents += 1;
        });
      }
    };
  });
  await page.goto('/workouts');
  await expect(
    page.getByRole('button', { name: 'Завершить', exact: true }),
  ).toBeVisible();
  await expect(firstWeight).toBeEditable();
  await page.waitForFunction(
    () =>
      (window as typeof window & { workoutRevisionEvents: number })
        .workoutRevisionEvents > 0,
  );
  const liveWorkout = await readWorkout();
  expect(liveWorkout).toBeTruthy();
  let releaseStaleRead!: () => void;
  let staleReadCaptured!: () => void;
  const staleReadReady = new Promise<void>((resolve) => {
    staleReadCaptured = resolve;
  });
  const staleReadRelease = new Promise<void>((resolve) => {
    releaseStaleRead = resolve;
  });
  let held = false;
  const workoutReadUrl = `**/api/workouts?ownerId=${owner}`;
  await page.route(workoutReadUrl, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (
      !held &&
      body.data.workouts.some(
        (workout: { note: string }) => workout.note === 'Owner live edit',
      )
    ) {
      held = true;
      staleReadCaptured();
      await staleReadRelease;
    }
    await route.fulfill({ response });
  });
  const ownerEdit = async (revision: number, text: string) => {
    const response = await request.put(`/api/workouts/${liveWorkout!.id}`, {
      headers: { Origin: testOrigin },
      data: {
        ownerId: owner,
        revision,
        requestId: crypto.randomUUID(),
        data: {
          date: liveWorkout!.date,
          title: liveWorkout!.title,
          status: liveWorkout!.status,
          exercises: liveWorkout!.exercises,
          note: text,
        },
      },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).data as { revision: number };
  };
  const initialRevisionEvents = await page.evaluate(
    () =>
      (window as typeof window & { workoutRevisionEvents: number })
        .workoutRevisionEvents,
  );
  try {
    const firstEdit = await ownerEdit(liveWorkout!.revision, 'Owner live edit');
    await staleReadReady;
    await page.waitForFunction(
      (previous) =>
        (window as typeof window & { workoutRevisionEvents: number })
          .workoutRevisionEvents > previous,
      initialRevisionEvents,
    );
    const revisionEvents = await page.evaluate(
      () =>
        (window as typeof window & { workoutRevisionEvents: number })
          .workoutRevisionEvents,
    );
    await ownerEdit(firstEdit.revision, 'Owner second live edit');
    await page.waitForFunction(
      (previous) =>
        (window as typeof window & { workoutRevisionEvents: number })
          .workoutRevisionEvents > previous,
      revisionEvents,
    );
    releaseStaleRead();
    await expect(note).toHaveValue('Owner second live edit');
  } finally {
    releaseStaleRead();
    await page.unroute(workoutReadUrl);
  }
  await context.setOffline(true);
  await firstWeight.fill('30');
  await page
    .getByRole('button', { name: 'Добавить подход', exact: true })
    .first()
    .click();
  await expect(thirdWeight).toHaveValue('25');
  await page
    .getByLabel('Smoke squat, Подход 3, Повторения', { exact: true })
    .fill('6');
  await page
    .getByRole('button', { name: 'Добавить упражнения', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Поиск по названию', exact: true })
    .fill('Trainer offline exercise');
  await page
    .getByRole('button', {
      name: 'Добавить вручную: Trainer offline exercise',
      exact: true,
    })
    .click();
  await note.fill('Trainer offline changes');
  await expect(
    page.getByText(
      'Результаты сохранены на устройстве и отправятся при подключении.',
      { exact: true },
    ),
  ).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(async () => {
      const workout = await readWorkout();
      return (
        workout && {
          status: workout.status,
          note: workout.note,
          sets: workout.exercises[0]?.sets,
          added: workout.exercises.some(
            (exercise) => exercise.name === 'Trainer offline exercise',
          ),
        }
      );
    })
    .toEqual({
      status: 'in_progress',
      note: 'Trainer offline changes',
      sets: [
        { weightKg: 30, reps: 10 },
        { weightKg: 25, reps: 8 },
        { weightKg: 25, reps: 6 },
      ],
      added: true,
    });
});
