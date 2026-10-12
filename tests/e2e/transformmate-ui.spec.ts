import { test, expect, type Page } from '@playwright/test';

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
        data: {
          items: [
            { id: 7, name: 'Приседание из каталога', canPlan: true },
            { id: 8, name: 'Не поддержано', canPlan: false },
            { id: 9, name: 'Другое упражнение', canPlan: true },
          ],
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
          id: 9,
          name: 'Другое упражнение',
          description: 'Другая техника',
          canPlan: true,
          hasVideo: false,
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
  const owner = (await (await page.request.get('/api/auth/get-session')).json())
    .user.id;
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
  const dialog = page.getByRole('dialog');
  const title = `Каталог ${test.info().project.name} ${Date.now()}`;
  await dialog
    .getByRole('textbox', { name: 'Название тренировки 1', exact: true })
    .fill(title);
  await dialog
    .getByRole('button', { name: 'Добавить упражнение', exact: true })
    .click();
  const picker = page.getByRole('dialog', { name: 'Добавить упражнение' });
  await picker.getByLabel('Поиск упражнений TransformMate').fill('присед');
  await expect(
    picker.getByRole('button', { name: 'Не поддержано' }),
  ).toBeDisabled();
  await picker
    .getByRole('button', { name: 'Приседание из каталога', exact: true })
    .click();
  await expect(dialog.getByText('Держите спину ровно')).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Показать обучающее видео' }),
  ).toBeVisible();
  expect(mediaRequests).toBe(0);
  await dialog
    .getByRole('button', { name: 'Показать обучающее видео' })
    .click();
  await expect(dialog.locator('video')).toHaveCount(1);
  expect(mediaRequests).toBe(0);
  await dialog.getByRole('button', { name: 'Скрыть видео' }).click();
  await expect(dialog.locator('video')).toHaveCount(0);
  await dialog
    .getByRole('button', { name: 'Показать обучающее видео' })
    .click();
  await dialog
    .getByRole('button', { name: 'Выбрать из каталога', exact: true })
    .click();
  await picker.getByLabel('Поиск упражнений TransformMate').fill('другое');
  await picker
    .getByRole('button', { name: 'Другое упражнение', exact: true })
    .click();
  await expect(dialog.getByText('Другая техника')).toBeVisible();
  await expect(dialog.getByText('Держите спину ровно')).toHaveCount(0);
  await expect(dialog.locator('video')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Скрыть видео' }),
  ).toHaveCount(0);
  await dialog
    .getByRole('button', { name: 'Выбрать из каталога', exact: true })
    .click();
  await picker
    .getByRole('button', { name: 'Ввести упражнение вручную', exact: true })
    .click();
  const manualName = dialog.getByRole('textbox', {
    name: 'Упражнение 1',
    exact: true,
  });
  await expect(manualName).toBeEditable();
  await manualName.fill('Ручное упражнение');
  await dialog
    .getByRole('button', { name: 'Выбрать из каталога', exact: true })
    .click();
  await picker.getByLabel('Поиск упражнений TransformMate').fill('присед');
  await picker
    .getByRole('button', { name: 'Приседание из каталога', exact: true })
    .click();
  await expect(dialog.getByText('Держите спину ровно')).toBeVisible();
  await expect(dialog.locator('video')).toHaveCount(0);

  await dialog.getByLabel('Комментарий к упражнению').fill('Медленно');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const plans = (
    await (await page.request.get(`/api/workouts?ownerId=${owner}`)).json()
  ).data.plans;
  const original = plans.find(
    (plan: { title: string }) => plan.title === title,
  );
  expect(original.workouts[0].exercises[0].transformMate.exerciseId).toBe(7);
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
    .getByRole('button', { name: 'Копировать на новые даты' })
    .click();
  await dialog.getByLabel('Новая дата начала').fill('2026-10-24');
  await dialog
    .getByRole('button', { name: 'Копировать на новые даты' })
    .click();
  await expect(dialog.getByLabel('Дата 1')).toHaveValue('2026-10-24');
  await dialog
    .getByRole('textbox', { name: 'Название плана', exact: true })
    .fill(`${title} копия`);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const copied = (
    await (await page.request.get(`/api/workouts?ownerId=${owner}`)).json()
  ).data.plans.find(
    (plan: { title: string }) => plan.title === `${title} копия`,
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
  await page.getByRole('button', { name: 'Все дни этого плана' }).click();
  await page
    .getByTestId(`plan-${original.id}`)
    .getByRole('button', { name: 'Удалить весь план', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Подтвердить удаление', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('tab', { name: 'История' })).toHaveCount(0);
  await expect(
    page.getByText('Ноги TransformMate', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Вес: 42 кг', { exact: false }).first(),
  ).toBeVisible();
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
