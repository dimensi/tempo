import { testOrigin } from '../ci/origin';
import { richCatalogFields } from '../fixtures/workout-catalog';
import { getSessionWith429Retry } from './auth-session';
import { test, expect, type Page } from '../ci/isolated-test';
import { workoutMessages as workoutMessages } from '@/features/workouts/messages';

test('initial TransformMate GET finishes before automatic POST and fresh sync remains persisted', async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const initialRead = new Promise<void>((resolve) => {
    started = resolve;
  });
  let released = false;
  let postedBeforeRead = false;
  const data = (configured: boolean) => ({
    data: {
      configured,
      items: [],
      nativePage: { items: [], nextCursor: null },
      nativeRefresh: {
        status: configured ? 'fresh' : 'idle',
        checkedAt: null,
        errorCode: null,
      },
    },
  });
  await page.route('**/api/workouts/transformmate?*', async (route) => {
    if (route.request().method() === 'GET') {
      started();
      await held;
      await route.fulfill({ json: data(false) });
    } else {
      postedBeforeRead ||= !released;
      await route.fulfill({ json: data(true) });
    }
  });
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/workouts/transformmate' &&
      response.request().method() === 'POST',
  );
  await page.goto('/workouts?date=2026-06-14');
  await initialRead;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  released = true;
  release();
  await refreshed;
  expect(postedBeforeRead).toBe(false);
  await expect(
    page.getByText(workoutMessages.notConfigured, { exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open('yazio-offline-read-v1', 3);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction('resources', 'readonly');
              const rows = tx.objectStore('resources').getAll();
              rows.onsuccess = () =>
                resolve(
                  rows.result.some(
                    (row) =>
                      row.record.key.startsWith(
                        '/api/workouts/transformmate?',
                      ) &&
                      JSON.parse(row.record.body).data.nativeRefresh.status ===
                        'fresh',
                  ),
                );
              tx.oncomplete = () => db.close();
            };
          }),
      ),
    )
    .toBe(true);
});

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  const submit = async () => {
    const response = page.waitForResponse((value) =>
      value.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    return response;
  };
  let response = await submit();
  if (response.status() === 429) {
    const seconds = Number(
      response.headers()['x-retry-after'] ??
        response.headers()['retry-after'] ??
        10,
    );
    expect(
      Number.isFinite(seconds) && seconds >= 0,
      'Sign-in rate limit must include a valid numeric retry interval',
    ).toBe(true);
    await page.waitForTimeout((seconds + 1) * 1000);
    response = await submit();
  }
  expect(
    response.status(),
    `Sign-in failed with HTTP ${response.status()}`,
  ).toBe(200);
  await expect(page).toHaveURL('/');
}

test('catalog selection persists links and copy makes a fresh dated plan using real login', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let syncItems: unknown[] = [];
  await page.route('**/api/workouts/transformmate?*', (route) =>
    route.fulfill({
      json: {
        contractVersion: 1,
        source: 'user',
        data: {
          configured: true,
          items: syncItems,
          nativePage: {
            items: [
              {
                source: 'transformmate',
                remoteTrainingId: 91,
                date: '2026-03-29',
                title: 'Бег из TransformMate',
                progress: 'planned',
                started: null,
                finished: null,
                remoteUpdatedAt: '2026-03-29T09:00:00Z',
                fetchedAt: '2026-10-12T00:00:00Z',
                exercises: [
                  {
                    protocolId: 1,
                    protocolOrder: 1,
                    remoteExerciseId: 4,
                    exerciseId: 7,
                    order: 1,
                    name: 'Бег',
                    comment: 'Ровный темп',
                    metrics: [
                      {
                        type: 'plan',
                        sets: [
                          {
                            order: 1,
                            done: null,
                            metrics: [
                              {
                                key: 'distance',
                                name: 'Расстояние',
                                unit: 'км',
                                type: 'single',
                                values: ['5'],
                              },
                            ],
                          },
                        ],
                      },
                      {
                        type: 'fact',
                        sets: [
                          {
                            order: 1,
                            done: true,
                            metrics: [
                              {
                                key: 'distance',
                                name: 'Расстояние',
                                unit: 'км',
                                type: 'single',
                                values: ['4.8'],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            nextCursor: null,
          },
          nativeRefresh: {
            status: 'fresh',
            checkedAt: '2026-10-12T00:00:00Z',
            errorCode: null,
          },
        },
      },
    }),
  );
  await page.route('**/api/workouts/transformmate/exercises?*', (route) =>
    route.fulfill({
      json: {
        contractVersion: 1,
        source: 'user',
        data: [
          {
            ...richCatalogFields,
            id: 7,
            name: 'Приседание из каталога',
            canPlan: true,
          },
          {
            ...richCatalogFields,
            id: 8,
            name: 'Не поддержано',
            canPlan: false,
          },
          {
            ...richCatalogFields,
            id: 9,
            name: 'Другое упражнение',
            canPlan: true,
          },
        ],
        catalog: {
          fetchedAt: '2026-10-12T00:00:00Z',
          stale: false,
          coverage: 'complete',
          refreshState: 'idle',
          total: 3,
          hasMore: true,
          unknownMembershipCount: 0,
          filters: {
            query: '',
            commonMuscleGroup: null,
            muscleGroups: [],
            offset: 0,
            limit: 20,
          },
        },
      },
    }),
  );
  await page.route('**/api/workouts/transformmate/exercises/7?*', (route) =>
    route.fulfill({
      json: {
        contractVersion: 1,
        source: 'user',
        data: {
          ...richCatalogFields,
          muscles: [],
          stale: false,
          id: 7,
          name: 'Приседание из каталога',
          description: 'Держите спину ровно',
          canPlan: true,
          hasVideo: true,
        },
      },
    }),
  );
  await page.route('**/api/workouts/transformmate/exercises/9?*', (route) =>
    route.fulfill({
      json: {
        contractVersion: 1,
        source: 'user',
        data: {
          ...richCatalogFields,
          muscles: [],
          stale: false,
          id: 9,
          name: 'Другое упражнение',
          description: 'Другая техника',
          canPlan: true,
          hasVideo: false,
        },
      },
    }),
  );
  await page.route('**/api/workouts/transformmate/exercises/8?*', (route) =>
    route.fulfill({
      json: {
        contractVersion: 1,
        source: 'user',
        data: {
          ...richCatalogFields,
          id: 8,
          name: 'Не поддержано',
          canPlan: false,
          hasVideo: false,
          description: 'Техника без добавления',
          muscles: [],
          stale: false,
          publicationCapability: {
            state: 'unsupported',
            reason: 'metric_count',
          },
        },
      },
    }),
  );
  await page.route('**/api/workouts/transformmate/muscle-groups?*', (route) =>
    route.fulfill({
      json: {
        contractVersion: 1,
        source: 'user',
        data: {
          groups: [
            {
              id: 1,
              name: 'Квадрицепсы',
              commonGroup: { id: 10, name: 'Ноги' },
              muscleIds: [11],
            },
            {
              id: 2,
              name: 'Ягодицы',
              commonGroup: { id: 10, name: 'Ноги' },
              muscleIds: [12],
            },
          ],
          fetchedAt: '2026-10-12T00:00:00Z',
          stale: false,
          coverage: 'complete',
        },
      },
    }),
  );
  let mediaRequests = 0;
  await page.route(
    '**/api/workouts/transformmate/exercises/7/video?*',
    (route) => {
      mediaRequests++;
      return route.fulfill({ status: 404 });
    },
  );
  await login(page);
  const owner = (await getSessionWith429Retry(page.request)).user.id;
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Выбрать дату' }).click();
  await page.getByRole('textbox', { name: 'Год', exact: true }).fill('2026');
  await page
    .getByRole('combobox', { name: 'Месяц', exact: true })
    .selectOption('03');
  await page
    .getByRole('combobox', { name: 'День', exact: true })
    .selectOption('29');
  await page.getByRole('button', { name: 'Открыть дату', exact: true }).click();
  await page.keyboard.press('Escape');
  const nativeCard = page.getByTestId('native-workout-91');
  await expect(nativeCard).toContainText('Расстояние: 5 км');
  await expect(nativeCard).toContainText('Расстояние: 4.8 км');
  await expect(nativeCard.getByRole('button')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Добавить тренировку', exact: true })
    .click();
  const dialog = page;
  const copyDialog = page.getByRole('dialog', {
    name: 'Копировать на другую дату',
    exact: true,
  });
  const title = `Каталог ${test.info().project.name} ${Date.now()}`;
  await dialog
    .getByRole('textbox', { name: 'Название (необязательно)', exact: true })
    .fill(title);
  const picker = page;
  const exerciseSearch = picker.getByRole('combobox', {
    name: 'Упражнение',
    exact: true,
  });
  await expect(
    picker.getByRole('combobox', { name: 'Область тела', exact: true }).first(),
  ).toBeVisible();
  await expect(
    picker.getByRole('combobox', { name: 'Группы мышц', exact: true }).first(),
  ).toBeVisible();
  await picker
    .getByRole('combobox', { name: 'Область тела', exact: true })
    .first()
    .click();
  await expect(
    picker.getByRole('option', { name: 'Ноги', exact: true }),
  ).toBeVisible();
  if (test.info().project.name === 'mobile') {
    await picker.getByRole('option', { name: 'Ноги', exact: true }).tap();
  } else {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }
  await exerciseSearch.fill('присед');
  await picker
    .getByRole('combobox', { name: 'Группы мышц', exact: true })
    .first()
    .click();
  const filtered = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === '/api/workouts/transformmate/exercises' &&
      url.searchParams.get('commonMuscleGroup') === 'Ноги' &&
      url.searchParams.getAll('muscleGroup').includes('Квадрицепсы')
    );
  });
  const firstMuscle = picker.getByRole('option', {
    name: 'Квадрицепсы',
    exact: true,
  });
  if (test.info().project.name === 'mobile') await firstMuscle.tap();
  else await firstMuscle.click();
  await filtered;
  await picker.getByRole('option', { name: 'Ягодицы', exact: true }).click();
  await page.keyboard.press('Escape');
  await dialog.getByLabel('Комментарий к упражнению').click();
  await expect(exerciseSearch).toHaveValue('присед');
  await expect(
    picker.getByRole('combobox', { name: 'Область тела', exact: true }).first(),
  ).toHaveValue('Ноги');
  const muscleField = picker
    .getByRole('combobox', {
      name: 'Группы мышц',
      exact: true,
    })
    .first();
  await expect(muscleField.locator('..')).toContainText('Квадрицепсы');
  await expect(muscleField.locator('..')).toContainText('Ягодицы');
  await exerciseSearch.focus();
  await page.keyboard.press('Escape');
  await expect(exerciseSearch).toHaveValue('присед');
  const nextPage = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === '/api/workouts/transformmate/exercises' &&
      url.searchParams.get('q') === 'присед' &&
      url.searchParams.get('commonMuscleGroup') === 'Ноги' &&
      url.searchParams.getAll('muscleGroup').length === 2 &&
      url.searchParams.get('offset') === '20'
    );
  });
  await picker
    .getByRole('button', { name: 'Следующие упражнения', exact: true })
    .click();
  await nextPage;
  await exerciseSearch.focus();
  await page.keyboard.press('Escape');
  await picker
    .getByRole('button', { name: 'Сбросить фильтры', exact: true })
    .click();
  await expect(
    picker.getByRole('combobox', { name: 'Область тела', exact: true }).first(),
  ).toHaveValue('');
  await expect(exerciseSearch).toHaveValue('присед');
  await expect(muscleField.locator('..')).not.toContainText('Квадрицепсы');
  await expect(muscleField.locator('..')).not.toContainText('Ягодицы');

  await picker
    .getByRole('combobox', { name: 'Упражнение', exact: true })
    .fill('присед');
  await expect(
    picker.getByRole('option', { name: 'Не поддержано', exact: true }),
  ).toContainText('Только просмотр');
  await picker
    .getByRole('option', { name: 'Не поддержано', exact: true })
    .click();
  await expect(picker.getByTestId('exercise-details-8')).toContainText(
    'Техника без добавления',
  );
  await expect(
    picker.getByRole('combobox', { name: 'Упражнение', exact: true }),
  ).toHaveValue('присед');
  await picker
    .getByRole('combobox', { name: 'Упражнение', exact: true })
    .click();
  await picker
    .getByRole('combobox', { name: 'Упражнение', exact: true })
    .fill('присед');
  await picker
    .getByRole('option', { name: 'Приседание из каталога', exact: true })
    .click();
  await expect(dialog.getByText('Держите спину ровно')).toBeVisible();
  await expect(dialog.locator('video')).toHaveCount(1);
  expect(mediaRequests).toBe(0);
  await expect(dialog.locator('video')).toHaveAttribute('preload', 'none');
  await picker
    .getByRole('combobox', { name: 'Упражнение', exact: true })
    .fill('другое');
  await picker
    .getByRole('option', { name: 'Другое упражнение', exact: true })
    .click();
  await expect(dialog.getByText('Другая техника')).toBeVisible();
  await expect(dialog.getByText('Держите спину ровно')).toHaveCount(0);
  await expect(dialog.locator('video')).toHaveCount(0);

  const manualName = dialog.getByRole('combobox', {
    name: 'Упражнение',
    exact: true,
  });
  await manualName.fill('Ручное упражнение');
  await picker
    .getByRole('option', {
      name: 'Добавить вручную: Ручное упражнение',
      exact: true,
    })
    .click();
  await expect(dialog.locator('video')).toHaveCount(0);
  await picker
    .getByRole('combobox', { name: 'Упражнение', exact: true })
    .fill('присед');
  await picker
    .getByRole('option', { name: 'Приседание из каталога', exact: true })
    .click();
  await expect(dialog.getByText('Держите спину ровно')).toBeVisible();
  await expect(dialog.locator('video')).toHaveCount(1);

  await dialog.getByLabel('Комментарий к упражнению').fill('Медленно');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(
    /\/workouts\/plans\/[^/]+\/workouts\/[^?]+\?date=/,
  );
  const plans = (
    await (await page.request.get(`/api/workouts?ownerId=${owner}`)).json()
  ).data.plans;
  const original = plans.find(
    (plan: { workouts: { title: string }[] }) =>
      plan.workouts[0]?.title === title,
  );
  expect(original.workouts[0].exercises[0].transformMate.exerciseId).toBe(7);
  const savedView = page.getByTestId(`plan-${original.id}`);
  await savedView
    .getByRole('button', {
      name: 'Об упражнении: Приседание из каталога',
      exact: true,
    })
    .click();
  await expect(savedView.getByTestId('exercise-details-7')).toContainText(
    'Держите спину ровно',
  );
  await expect(savedView.locator('video')).toHaveCount(1);
  expect(mediaRequests).toBe(0);
  await expect(
    savedView.getByRole('button', { name: 'Все дни плана' }),
  ).toHaveCount(0);
  await expect(
    savedView.getByRole('columnheader', { name: 'План', exact: true }),
  ).toBeVisible();
  await expect(
    savedView.getByRole('columnheader', { name: 'Факт', exact: true }),
  ).toBeVisible();

  // A neighbouring plan represents data left by another case or a failed retry.
  const origin = testOrigin;
  const neighbourResponse = await page.request.post(
    `/api/workouts/plans?ownerId=${owner}`,
    {
      headers: { origin },
      data: {
        title: `${title} соседний план`,
        description: '',
        startsOn: '2026-03-29',
        endsOn: '2026-03-29',
        workouts: [
          {
            id: crypto.randomUUID(),
            date: '2026-03-29',
            title: `${title} соседняя тренировка`,
            exercises: [
              {
                name: 'Ручное упражнение',
                sets: [{ reps: 8, weightKg: null }],
              },
            ],
          },
        ],
      },
    },
  );
  expect(neighbourResponse.ok()).toBe(true);
  const neighbour = (await neighbourResponse.json()).data;
  syncItems = [
    {
      id: crypto.randomUUID(),
      planId: original.id,
      workoutId: original.workouts[0].id,
      remoteTrainingId: 7,
      status: 'conflict',
      reason: 'plan_changed',
      checkedAt: '2026-10-12T00:00:00Z',
      planSnapshot: {
        planTitle: original.title,
        workout: original.workouts[0],
      },
      actual: {
        date: '2026-03-29',
        title: 'Ноги TransformMate',
        started: '2026-03-29T09:00:00Z',
        finished: '2026-03-29T10:00:00Z',
        exercises: [
          {
            occurrenceKey:
              original.workouts[0].exercises[0].transformMate.occurrenceKey,
            exerciseId: 7,
            name: 'Приседание из каталога',
            comment: '',
            sets: [
              {
                order: 1,
                done: true,
                metrics: [
                  {
                    name: 'Повторения',
                    unit: '',
                    type: 'single',
                    values: ['9'],
                  },
                  { name: 'Вес', unit: 'кг', type: 'single', values: ['42'] },
                ],
              },
            ],
          },
        ],
      },
    },
  ];
  await page.goto('/workouts?date=2026-03-29');
  await page
    .getByRole('button', { name: 'Обновить статус и результаты' })
    .click();
  await expect(page.getByTestId(`plan-${original.id}`)).toContainText(
    'Изменения сохранены здесь.',
  );
  await expect(page.getByTestId(`plan-${original.id}`)).toContainText(
    'Вес: 42 кг',
  );
  await page
    .getByTestId(`plan-${original.id}`)
    .getByRole('button', { name: 'Копировать на другую дату' })
    .click();
  await copyDialog.getByLabel('Новая дата').fill('2026-10-24');
  await copyDialog
    .getByRole('button', { name: 'Копировать на другую дату' })
    .click();
  await expect(dialog.getByLabel('Дата')).toHaveValue('2026-10-24');
  await page
    .getByRole('textbox', { name: 'Название (необязательно)', exact: true })
    .fill(`${title} копия`);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(
    /\/workouts\/plans\/[^/]+\/workouts\/[^?]+\?date=/,
  );
  const copied = (
    await (await page.request.get(`/api/workouts?ownerId=${owner}`)).json()
  ).data.plans.find(
    (plan: { workouts: { title: string }[] }) =>
      plan.workouts[0]?.title === `${title} копия`,
  );
  expect(copied.workouts[0].id).not.toBe(original.workouts[0].id);
  expect(copied.workouts[0].exercises[0].transformMate.occurrenceKey).not.toBe(
    original.workouts[0].exercises[0].transformMate.occurrenceKey,
  );
  expect(copied.workouts[0].exercises[0].comment).toBe('Медленно');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto('/workouts?date=2026-03-29');
  const originalCard = page.getByTestId(`plan-${original.id}`);
  await originalCard
    .getByRole('button', { name: 'Удалить весь план', exact: true })
    .click();
  const deleteDialog = page.getByRole('dialog', {
    name: 'Подтвердить удаление',
    exact: true,
  });
  await expect(deleteDialog).toBeVisible();
  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname === `/api/workouts/plans/${original.id}`,
  );
  await deleteDialog
    .getByRole('button', { name: 'Подтвердить удаление', exact: true })
    .click();
  expect((await deleted).ok()).toBe(true);
  await expect(deleteDialog).not.toBeVisible();
  await expect(originalCard).toHaveCount(0);
  await expect(page.getByTestId(`plan-${neighbour.id}`)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'История' })).toHaveCount(0);
  await expect(
    page.getByText('Ноги TransformMate', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Вес: 42 кг', { exact: true })).toBeVisible();
  const cleanup = await page.request.delete(
    `/api/workouts/plans/${neighbour.id}?ownerId=${owner}`,
    {
      headers: { origin },
      data: { revision: neighbour.revision },
    },
  );
  expect(cleanup.ok()).toBe(true);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: test.info().outputPath('workouts-history.png'),
    fullPage: true,
  });
  expect(pageErrors).toEqual([]);
});

test('real authenticated session throttle is retried once after its server interval', async ({
  page,
}) => {
  await login(page);
  let throttled = false;
  for (let request = 0; request < 40; request++) {
    const response = await page.request.get('/api/auth/get-session');
    if (response.status() === 429) {
      throttled = true;
      await response.dispose();
      break;
    }
    expect(response.status()).toBe(200);
    expect((await response.json()).user.role).toBe('OWNER');
    await response.dispose();
  }
  expect(throttled, 'The genuine fixture API quota must produce HTTP 429').toBe(
    true,
  );
  const statuses: number[] = [];
  const session = await getSessionWith429Retry(page.request, {
    onStatus: (status) => statuses.push(status),
  });
  expect(statuses).toEqual([429, 200]);
  expect(session.user).toMatchObject({
    role: 'OWNER',
    email: 'owner@example.test',
  });
  expect(session.user.id.length).toBeGreaterThan(0);
});
