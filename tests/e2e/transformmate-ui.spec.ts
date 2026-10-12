import { test, expect } from '@playwright/test';
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
        data: { configured: true, items: syncItems },
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
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL('/');
  const owner = (await (await page.request.get('/api/auth/get-session')).json())
    .user.id;
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Создать план', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const title = `Каталог ${test.info().project.name} ${Date.now()}`;
  await dialog
    .getByRole('textbox', { name: 'Название плана', exact: true })
    .fill(title);
  await dialog.getByLabel('Начало плана').fill('2026-03-28');
  await dialog.getByLabel('Конец плана').fill('2026-03-30');
  await dialog
    .getByRole('textbox', { name: 'Название тренировки 1', exact: true })
    .fill('Ноги');
  await dialog.getByLabel('Дата 1').fill('2026-03-29');
  await dialog.getByLabel('Поиск упражнений TransformMate').fill('присед');
  await expect(
    dialog.getByRole('button', { name: 'Не поддержано' }),
  ).toBeDisabled();
  await dialog
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
  await dialog.getByLabel('Поиск упражнений TransformMate').fill('другое');
  await dialog
    .getByRole('button', { name: 'Другое упражнение', exact: true })
    .click();
  await expect(dialog.getByText('Другая техника')).toBeVisible();
  await expect(dialog.getByText('Держите спину ровно')).toHaveCount(0);
  await expect(dialog.locator('video')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Скрыть видео' }),
  ).toHaveCount(0);
  await dialog.getByLabel('Поиск упражнений TransformMate').fill('присед');
  await dialog
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
    .getByRole('button', { name: 'Проверить / повторить отправку' })
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
  await expect(dialog.getByLabel('Дата 1')).toHaveValue('2026-10-25');
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
  await page
    .getByTestId(`plan-${original.id}`)
    .getByRole('button', { name: 'Удалить', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Подтвердить удаление', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('tab', { name: 'История' }).click();
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
