import { expect, test, type Page } from '@playwright/test';
import { testOrigin } from './origin';
import { readFileSync } from 'node:fs';

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
          const body = read.result.find((row) =>
            String(row.record?.body).includes(title),
          )?.record?.body;
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

test('real login reaches core sections, recovers a cached workout offline, purges logout data, and blocks a trainer', async ({
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
    page.getByRole('status').filter({ hasText: 'Ссылка скопирована' }),
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

  await page.goto('/diary');
  await expect(
    page.getByRole('heading', { name: 'Дневник питания', exact: true }),
  ).toBeVisible();
  await page.goto('/workouts');
  await page
    .getByRole('button', { name: 'Добавить тренировку', exact: true })
    .click();
  const title = 'Production smoke workout';
  await expect(
    page.getByRole('textbox', { name: 'Описание', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Название (необязательно)', exact: true })
    .fill(title);
  await page
    .getByRole('button', { name: 'Добавить упражнения', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Поиск по названию', exact: true })
    .fill('Smoke squat');
  await page
    .getByRole('button', { name: 'Добавить вручную: Smoke squat', exact: true })
    .click();
  await page
    .getByLabel('Smoke squat, Подход 1, Вес, кг', { exact: true })
    .fill('0');
  await page
    .getByRole('button', { name: 'Сохранить план', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Завершить тренировку', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Техника: Smoke squat', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', {
      name: 'Название (необязательно)',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Удалить подход 1: Smoke squat',
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole('button', {
      name: 'Заполнить по плану, Подход 1: Smoke squat',
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel('Smoke squat, Подход 1, Повторения', { exact: true }),
  ).toHaveValue('10');
  await page
    .getByRole('button', { name: 'Добавить подход', exact: true })
    .click();
  await page
    .getByLabel('Smoke squat, Подход 2, Повторения', { exact: true })
    .fill('12');
  await page
    .getByRole('button', { name: 'Удалить подход 2: Smoke squat', exact: true })
    .click();
  await expect(
    page.getByLabel('Smoke squat, Подход 2, Повторения', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel('Smoke squat, Подход 1, Повторения', { exact: true }),
  ).toHaveValue('10');
  await page
    .getByLabel('Smoke squat, Подход 1, Повторения', { exact: true })
    .fill('8');
  await page
    .getByRole('button', { name: 'Завершить тренировку', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Отменить завершение', exact: true }),
  ).toBeVisible();

  // A background-acknowledged offline edit becomes the status action's new base.
  await context.setOffline(true);
  await page
    .getByLabel('Заметка к тренировке', { exact: true })
    .fill('Saved while offline');
  await expect(
    page.getByText(
      'Результаты сохранены на устройстве и отправятся при подключении.',
      { exact: true },
    ),
  ).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(async () => {
      const body = await (
        await page.request.get(`/api/workouts?ownerId=${owner}`)
      ).json();
      return body.data.sessions.find(
        (item: { title: string }) => item.title === title,
      )?.note;
    })
    .toBe('Saved while offline');

  // A regular edit after background acknowledgement must use the accepted revision too.
  await page
    .getByLabel('Заметка к тренировке', { exact: true })
    .fill('Saved after reconnect');
  await expect
    .poll(async () => {
      const body = await (
        await page.request.get(`/api/workouts?ownerId=${owner}`)
      ).json();
      return body.data.sessions.find(
        (item: { title: string }) => item.title === title,
      )?.note;
    })
    .toBe('Saved after reconnect');

  // Reopening changes only status even when the form would remove a saved exercise.
  const savedWorkout = (
    await (await page.request.get(`/api/workouts?ownerId=${owner}`)).json()
  ).data.sessions.find((item: { title: string }) => item.title === title);
  await page
    .getByLabel('Smoke squat, Подход 1, Вес, кг', { exact: true })
    .fill('25');
  await page
    .getByLabel('Smoke squat, Подход 1, Повторения', { exact: true })
    .fill('');
  await expect(
    page.getByText('Есть несохранённые изменения', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Отменить завершение', exact: true })
    .click();
  await expect
    .poll(async () => {
      const body = await (
        await page.request.get(`/api/workouts?ownerId=${owner}`)
      ).json();
      return body.data.sessions.find(
        (item: { id: string }) => item.id === savedWorkout.id,
      )?.status;
    })
    .toBe('in_progress');
  const reopenedWorkout = (
    await (await page.request.get(`/api/workouts?ownerId=${owner}`)).json()
  ).data.sessions.find((item: { id: string }) => item.id === savedWorkout.id);
  expect(reopenedWorkout.exercises).toEqual(savedWorkout.exercises);
  expect(reopenedWorkout.note).toBe(savedWorkout.note);
  expect(reopenedWorkout.planSnapshot).toEqual(savedWorkout.planSnapshot);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByLabel('Smoke squat, Подход 1, Повторения', { exact: true }),
  ).toHaveValue('');
  await expect(
    page.getByLabel('Smoke squat, Подход 1, Вес, кг', { exact: true }),
  ).toHaveValue('25');
  await page
    .getByLabel('Smoke squat, Подход 1, Вес, кг', { exact: true })
    .fill('');
  await page
    .getByLabel('Smoke squat, Подход 1, Повторения', { exact: true })
    .fill('8');
  await page
    .getByRole('button', { name: 'Завершить тренировку', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Отменить завершение', exact: true }),
  ).toBeVisible();

  // An incomplete actual set must survive acknowledging an unrelated plan edit.
  await page
    .getByRole('button', { name: 'Добавить подход', exact: true })
    .click();
  await page
    .getByLabel('Smoke squat, Подход 2, Вес, кг', { exact: true })
    .fill('25');
  await page
    .getByRole('radiogroup', { name: 'Тренировка дня' })
    .getByText('План', { exact: true })
    .click();
  const planUpdate = page.waitForResponse(
    (response) =>
      response.url().includes('/api/workouts/plans/') &&
      response.request().method() === 'PUT' &&
      response.status() === 200,
  );
  await page
    .getByRole('button', { name: 'Сохранить план', exact: true })
    .click();
  await planUpdate;
  await expect(
    page.getByRole('button', { name: 'Сохранить план', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText('Есть несохранённые изменения', { exact: true }),
  ).toBeVisible();
  const dayUrl = page.url();
  await page.goto('/diary');
  await page.goto(dayUrl);
  await expect(
    page.getByLabel('Smoke squat, Подход 2, Вес, кг', { exact: true }),
  ).toHaveValue('25');
  await page
    .getByLabel('Smoke squat, Подход 2, Вес, кг', { exact: true })
    .fill('');

  // Coalesce a note edit made while the previous result is being committed.
  const sending = Promise.withResolvers<void>();
  const releaseWrite = Promise.withResolvers<void>();
  let delayed = false;
  await page.route('**/api/offline/writes', async (route) => {
    if (route.request().method() === 'POST' && !delayed) {
      delayed = true;
      sending.resolve();
      await releaseWrite.promise;
    }
    await route.continue();
  });
  await page
    .getByLabel('Заметка к тренировке', { exact: true })
    .fill('First note');
  await sending.promise;
  await page
    .getByLabel('Заметка к тренировке', { exact: true })
    .fill('Final note');
  // Intentionally cross the input debounce while the first write is held.
  await page.waitForTimeout(900);
  releaseWrite.resolve();
  await expect
    .poll(async () => {
      const body = await (
        await page.request.get(`/api/workouts?ownerId=${owner}`)
      ).json();
      return body.data.sessions.find(
        (item: { title: string }) => item.title === title,
      )?.note;
    })
    .toBe('Final note');
  await page.unroute('**/api/offline/writes');

  // Reverting to the accepted value clears dirty state without another write.
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  const resultNote = page.getByLabel('Заметка к тренировке', { exact: true });
  await resultNote.fill('Temporary note');
  await resultNote.fill('Final note');
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Есть несохранённые изменения', { exact: true }),
  ).toHaveCount(0);

  // A result debounce that expires during a plan request must be retried.
  const planSending = Promise.withResolvers<void>();
  const releasePlan = Promise.withResolvers<void>();
  await page.route('**/api/workouts/plans/*?*', async (route) => {
    if (route.request().method() === 'PUT') {
      planSending.resolve();
      await releasePlan.promise;
    }
    await route.continue();
  });
  const modes = page.getByRole('radiogroup', { name: 'Тренировка дня' });
  await modes.getByText('План', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Сохранить план', exact: true })
    .click();
  await planSending.promise;
  await modes.getByText('Выполнение', { exact: true }).click();
  await resultNote.fill('Saved after plan request');
  await page.waitForTimeout(900);
  releasePlan.resolve();
  await expect
    .poll(async () => {
      const body = await (
        await page.request.get(`/api/workouts?ownerId=${owner}`)
      ).json();
      return body.data.sessions.find(
        (item: { title: string }) => item.title === title,
      )?.note;
    })
    .toBe('Saved after plan request');
  await page.unroute('**/api/workouts/plans/*?*');

  await expect
    .poll(() => cachedReadBody(page, title).catch(() => ''))
    .toContain(title);
  const cachedWorkout = await cachedReadBody(page, title);
  const stalledRead = Promise.withResolvers<void>();
  const readStarted = Promise.withResolvers<void>();
  const readFinished = Promise.withResolvers<void>();
  await page.route('**/api/workouts?*', async (route) => {
    readStarted.resolve();
    try {
      await stalledRead.promise;
      await route.fulfill({
        contentType: 'application/json',
        body: cachedWorkout,
      });
    } finally {
      readFinished.resolve();
    }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await readStarted.promise;
  await expect(
    page.getByRole('button', { name: 'Техника: Smoke squat', exact: true }),
  ).toBeVisible();
  stalledRead.resolve();
  await readFinished.promise;
  await page.unroute('**/api/workouts?*');

  // One explicit download retains data and playable technique, then logout purges both.
  const gymDate = '2026-01-20';
  const techniqueId = 501;
  const exercise = {
    id: crypto.randomUUID(),
    name: 'Downloaded technique',
    transformMate: {
      exerciseId: techniqueId,
      occurrenceKey: crypto.randomUUID(),
    },
    sets: [{ reps: 10, weightKg: 20 }],
  };
  const repeated = [1, 2].map((count) => ({
    id: crypto.randomUUID(),
    name: 'Repeated manual',
    sets: Array.from({ length: count }, () => ({ reps: 12, weightKg: 30 })),
  }));
  const created = await page.request.post(
    `/api/workouts/plans?ownerId=${owner}`,
    {
      headers: { origin: testOrigin },
      data: {
        title: 'Gym download',
        description: '',
        startsOn: gymDate,
        endsOn: gymDate,
        workouts: [
          {
            id: crypto.randomUUID(),
            date: gymDate,
            title: 'Gym download',
            exercises: [exercise, ...repeated],
          },
        ],
      },
    },
  );
  expect(created.status()).toBe(200);
  const gymPlan = (await created.json()).data;
  const recordedId = crypto.randomUUID();
  expect(
    (
      await page.request.post(`/api/workouts/sessions?ownerId=${owner}`, {
        headers: { origin: testOrigin },
        data: {
          date: gymDate,
          title: 'Gym download',
          planId: gymPlan.id,
          plannedWorkoutId: gymPlan.workouts[0].id,
          exercises: [
            {
              id: recordedId,
              name: 'Repeated manual',
              sets: [{ reps: 6, weightKg: 15 }],
            },
          ],
          note: '',
          status: 'in_progress',
        },
      })
    ).status(),
  ).toBe(200);
  const technique = readFileSync(
    new URL('../fixtures/technique-demo.mp4', import.meta.url),
  );
  await page.route(
    '**/api/workouts/transformmate/exercises/501/video?*',
    (route) => route.fulfill({ contentType: 'video/mp4', body: technique }),
  );
  await page.goto(`/workouts?date=${gymDate}`);
  // Repeated manual rows retain separate guides and the original result ID.
  const repeatedRows = page.getByRole('region', {
    name: 'Упражнение: Repeated manual',
    exact: true,
  });
  await expect(repeatedRows).toHaveCount(2);
  await expect(
    repeatedRows.nth(0).getByLabel('Repeated manual, Подход 1, Повторения'),
  ).toHaveValue('6');
  await expect(
    repeatedRows.nth(1).getByLabel('Repeated manual, Подход 2, Повторения'),
  ).toHaveAttribute('placeholder', '12');
  // A comment is a result even before any sets are recorded for that occurrence.
  await repeatedRows
    .nth(1)
    .getByRole('button', { name: 'Действия с упражнением: Repeated manual' })
    .click();
  await page
    .getByRole('menuitem', { name: 'Комментарий к упражнению' })
    .click();
  await repeatedRows
    .nth(1)
    .getByLabel('Комментарий к упражнению')
    .fill('Skipped because of discomfort');
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Завершить тренировку', exact: true }),
  ).toBeEnabled();
  const commented = (
    await (await page.request.get(`/api/workouts?ownerId=${owner}`)).json()
  ).data.sessions.find((item: { date: string }) => item.date === gymDate);
  expect(commented.exercises).toHaveLength(2);
  expect(commented.exercises[0].id).toBe(recordedId);
  expect(commented.exercises[1]).toMatchObject({
    comment: 'Skipped because of discomfort',
    sets: [],
  });
  // Each repeated plan row must open the recordings of its own occurrence.
  const recordings = commented.exercises.map((item: { id: string }) => ({
    id: crypto.randomUUID(),
    sessionId: commented.id,
    exerciseId: item.id,
    size: 100,
    duration: 1,
    state: 'ready',
    parts: [0],
  }));
  await page.route('**/api/workouts/videos?*', (route) =>
    route.fulfill({ json: { data: recordings } }),
  );
  await modes.getByText('План', { exact: true }).click();
  await repeatedRows
    .nth(1)
    .getByRole('button', { name: 'Техника: Repeated manual', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByText('Мои видео', { exact: true })
    .click();
  await expect(page.getByRole('dialog').locator('video')).toHaveAttribute(
    'src',
    new RegExp(`/${recordings[1].id}/playback`),
  );
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.unroute('**/api/workouts/videos?*');
  await modes.getByText('Выполнение', { exact: true }).click();
  // Deleting results must leave the plan available and discard the deleted draft.
  await page.getByRole('button', { name: 'Действия с тренировкой' }).click();
  await page.getByRole('menuitem', { name: 'Удалить результаты' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Удалить', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const afterDeletion = (
    await (await page.request.get(`/api/workouts?ownerId=${owner}`)).json()
  ).data;
  expect(
    afterDeletion.plans.find((item: { id: string }) => item.id === gymPlan.id),
  ).toEqual(gymPlan);
  expect(
    afterDeletion.sessions.some(
      (item: { date: string }) => item.date === gymDate,
    ),
  ).toBe(false);
  await expect(
    repeatedRows.nth(0).getByLabel('Repeated manual, Подход 1, Повторения'),
  ).toHaveValue('');
  await page
    .getByRole('button', { name: 'Скачать тренировку', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Скачана для зала' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('status').filter({ hasText: 'Скачана для зала' }),
  ).toBeVisible();
  await context.setOffline(true);
  await page
    .getByRole('button', { name: 'Техника: Downloaded technique', exact: true })
    .click();
  await expect(
    page.getByText('Synthetic technique instructions', { exact: true }),
  ).toBeVisible();
  const media = page.locator('video');
  await expect(media).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Play Video', exact: true }).click();
  await expect
    .poll(() => media.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await context.setOffline(false);
  await page.goto(dayUrl);

  await context.setOffline(true);
  await expect(
    page.getByRole('button', { name: 'Техника: Smoke squat', exact: true }),
  ).toBeVisible();
  await context.setOffline(false);

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
});
