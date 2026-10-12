import { getSessionWith429Retry } from './auth-session';
import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import type { WorkoutsData } from '@/contracts/workouts';

async function login(page: Page, role: 'owner' | 'trainer' = 'owner') {
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill(`${role}@example.test`);
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  let response = page.waitForResponse((value) =>
    value.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const result = await response;
  if (result.status() === 429) {
    const seconds = Number(
      result.headers()['x-retry-after'] ??
        result.headers()['retry-after'] ??
        10,
    );
    // A legitimate server-directed wait must not consume the CRUD assertion budget.
    test.setTimeout(test.info().timeout + (seconds + 1) * 1000);
    await page.waitForTimeout((seconds + 1) * 1000);
    response = page.waitForResponse((value) =>
      value.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await response).ok()).toBe(true);
  } else expect(result.ok()).toBe(true);
  await expect(page).toHaveURL('/');
}
async function ownerId(page: Page) {
  return (await getSessionWith429Retry(page.request)).user.id;
}
async function workouts(page: Page, id: string): Promise<WorkoutsData> {
  const response = await page.request.get(`/api/workouts?ownerId=${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}
test('owner creates plan, logs actual, edits and deletes plan without changing history', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  const id = await ownerId(page);
  const title = `План ${test.info().project.name} ${Date.now()}`;
  await page.goto('/workouts');
  await page
    .getByRole('button', { name: 'Добавить тренировку', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await page
    .getByRole('textbox', { name: 'Название (необязательно)', exact: true })
    .fill(title);
  await page
    .getByRole('textbox', { name: 'Упражнение', exact: true })
    .fill('Приседание');
  await page.getByLabel('Вес, кг', { exact: true }).fill('40');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(/\/workouts\?date=/);
  const plan = (await workouts(page, id)).plans.find((value) =>
    value.workouts.some((workout) => workout.title === title),
  )!;
  const nextDay = new Date(`${plan.endsOn}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const otherWorkout = {
    id: crypto.randomUUID(),
    date: nextDay.toISOString().slice(0, 10),
    title: 'Другой день',
    exercises: [{ name: 'Жим', sets: [{ reps: 8, weightKg: 20 }] }],
  };
  const extended = await page.request.put(
    `/api/workouts/plans/${plan.id}?ownerId=${id}`,
    {
      headers: { origin: `http://localhost:${process.env.E2E_PORT ?? 3100}` },
      data: {
        revision: plan.revision,
        data: {
          title: plan.title,
          description: plan.description,
          startsOn: plan.startsOn,
          endsOn: otherWorkout.date,
          workouts: [...plan.workouts, otherWorkout],
        },
      },
    },
  );
  expect(extended.ok()).toBe(true);
  await page.reload();
  const card = page.getByTestId(`plan-${plan.id}`);
  await card.getByRole('button', { name: 'Записать результат' }).click();
  await dialog.getByLabel('Вес, кг', { exact: true }).fill('35');
  await dialog
    .getByLabel('Заметка', { exact: true })
    .fill('Фактическая нагрузка');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const session = (await workouts(page, id)).sessions.find(
    (value) => value.planId === plan.id,
  )!;
  await expect(card).toContainText('10 × 35 кг');
  await card
    .getByRole('button', { name: 'Изменить тренировку', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /Удалить тренировку/ }),
  ).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Название (необязательно)', exact: true })
    .fill(`${title} изменён`);
  await page.getByLabel('Вес, кг', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(/\/workouts\?date=/);
  const editedPlan = (await workouts(page, id)).plans.find(
    (value) => value.id === plan.id,
  )!;
  expect(
    editedPlan.workouts.find((workout) => workout.id === otherWorkout.id),
  ).toEqual(otherWorkout);
  await card.getByRole('button', { name: 'Все дни этого плана' }).click();
  await card
    .getByRole('button', { name: 'Удалить весь план', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Подтвердить удаление', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('tab', { name: 'История' })).toHaveCount(0);
  const history = page.getByTestId(`session-${session.id}`);
  await expect(history).toContainText(title);
  await expect(history).toContainText('Фактическая нагрузка');
  const stored = (await workouts(page, id)).sessions.find(
    (value) => value.id === session.id,
  )!;
  expect(stored.planSnapshot?.workout.exercises[0]?.sets[0]?.weightKg).toBe(40);
  expect(stored.exercises[0]?.sets[0]?.weightKg).toBe(35);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('real sessions enforce anonymous, trainer grant/revocation, owner scope and owner-only actual writes', async ({
  page,
  browser,
  request,
}) => {
  expect((await request.get('/api/workouts?ownerId=unknown')).status()).toBe(
    401,
  );
  await login(page);
  const id = await ownerId(page);
  const context = await browser.newContext({
    baseURL: `http://localhost:${process.env.E2E_PORT ?? 3100}`,
  });
  const trainer = await context.newPage();
  const database = new Database('.data/e2e.sqlite');
  const trainerId = database
    .prepare("SELECT id FROM user WHERE email = 'trainer@example.test'")
    .get() as { id: string };
  try {
    await login(trainer, 'trainer');
    expect(
      (await trainer.request.get(`/api/workouts?ownerId=${id}`)).status(),
    ).toBe(403);
    database
      .prepare(
        'INSERT INTO trainer_access (trainer_id, owner_id, created_at) VALUES (?, ?, ?)',
      )
      .run(trainerId.id, id, Date.now());
    await trainer.goto('/workouts');
    await expect(
      trainer.getByRole('button', { name: 'Добавить тренировку', exact: true }),
    ).toBeVisible();
    await expect(
      trainer.getByRole('button', {
        name: 'Записать выполненную тренировку',
        exact: true,
      }),
    ).toHaveCount(0);
    await trainer.goto('/workouts/new?date=2026-10-11');
    await expect(trainer.getByLabel('Название (необязательно)')).toBeEditable();
    await trainer.goto('/workouts?date=2026-10-11');
    const input = {
      title: 'План тренера',
      description: '',
      startsOn: '2026-10-11',
      endsOn: '2026-10-11',
      workouts: [
        {
          id: 'a',
          date: '2026-10-11',
          title: 'Силовая',
          exercises: [{ name: 'Жим', sets: [{ reps: 8, weightKg: 20 }] }],
        },
      ],
    };
    const created = await trainer.request.post(
      `/api/workouts/plans?ownerId=${id}`,
      {
        headers: { origin: `http://localhost:${process.env.E2E_PORT ?? 3100}` },
        data: input,
      },
    );
    expect(created.ok()).toBe(true);
    const plan = (await created.json()).data;
    const actual = {
      title: 'Силовая',
      date: '2026-10-11',
      status: 'completed',
      note: '',
      exercises: input.workouts[0]!.exercises,
    };
    expect(
      (
        await trainer.request.post(`/api/workouts/sessions?ownerId=${id}`, {
          headers: {
            origin: `http://localhost:${process.env.E2E_PORT ?? 3100}`,
          },
          data: actual,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await trainer.request.put(
          `/api/workouts/sessions/anything?ownerId=${id}`,
          {
            headers: {
              origin: `http://localhost:${process.env.E2E_PORT ?? 3100}`,
            },
            data: { revision: 1, data: actual },
          },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await trainer.request.delete(
          `/api/workouts/sessions/anything?ownerId=${id}`,
          {
            headers: {
              origin: `http://localhost:${process.env.E2E_PORT ?? 3100}`,
            },
            data: { revision: 1 },
          },
        )
      ).status(),
    ).toBe(403);
    expect(
      (await page.request.get('/api/workouts?ownerId=foreign')).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post(`/api/workouts/sessions?ownerId=${id}`, {
          headers: { origin: 'https://foreign.test' },
          data: actual,
        })
      ).status(),
    ).toBe(403);
    const updated = await trainer.request.put(
      `/api/workouts/plans/${plan.id}?ownerId=${id}`,
      {
        headers: { origin: `http://localhost:${process.env.E2E_PORT ?? 3100}` },
        data: { revision: 1, data: { ...input, title: 'Исправленный план' } },
      },
    );
    expect(updated.ok()).toBe(true);
    expect(
      (
        await trainer.request.put(
          `/api/workouts/plans/${plan.id}?ownerId=${id}`,
          {
            headers: {
              origin: `http://localhost:${process.env.E2E_PORT ?? 3100}`,
            },
            data: { revision: 1, data: input },
          },
        )
      ).status(),
    ).toBe(409);
    database
      .prepare('DELETE FROM trainer_access WHERE trainer_id = ?')
      .run(trainerId.id);
    expect(
      (await trainer.request.get(`/api/workouts?ownerId=${id}`)).status(),
    ).toBe(403);
    await trainer.goto(`/workouts/plans/${plan.id}/edit?date=2026-10-11`);
    await expect(
      trainer.getByText('Нет разрешения на доступ к тренировкам владельца.'),
    ).toBeVisible();
    await expect(trainer.getByLabel('Название (необязательно)')).toHaveCount(0);
  } finally {
    database
      .prepare('DELETE FROM trainer_access WHERE trainer_id = ?')
      .run(trainerId.id);
    database.close();
    await context.close();
  }
});

test('unnamed editor preserves drafts, handles errors and copies only the selected planned workout', async ({
  page,
}) => {
  await login(page);
  const id = await ownerId(page);
  const exerciseName = `Draft press ${test.info().project.name}`;
  const date = '2026-10-12';
  await page.goto(`/workouts?date=${date}`);
  await page
    .getByRole('button', { name: 'Добавить тренировку', exact: true })
    .click();
  await expect(page).toHaveURL(`/workouts/new?date=${date}`);
  await expect(page.getByLabel('Название (необязательно)')).not.toHaveAttribute(
    'required',
    '',
  );
  await page
    .getByRole('textbox', { name: 'Упражнение', exact: true })
    .fill(exerciseName);
  await page.getByLabel('Вес, кг', { exact: true }).fill('42');
  await page.getByRole('button', { name: 'Выбрать из каталога' }).click();
  await page.getByLabel('Поиск упражнений TransformMate').fill('жим');
  await expect(page.getByLabel('Вес, кг', { exact: true })).toHaveValue('42');
  await page.getByRole('button', { name: 'К тренировкам' }).click();
  await expect(page).toHaveURL(`/workouts?date=${date}`);
  await page.goBack();
  await expect(
    page.getByRole('textbox', { name: 'Упражнение', exact: true }),
  ).toHaveValue(exerciseName);
  await expect(page.getByLabel('Вес, кг', { exact: true })).toHaveValue('42');
  const keys: string[] = [];
  let fail = true;
  await page.route('**/api/workouts/plans?*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']!);
    if (fail) {
      fail = false;
      return route.fulfill({
        status: 500,
        json: { error: 'synthetic failure' },
      });
    }
    return route.continue();
  });
  await page
    .getByRole('textbox', { name: 'Дата', exact: true })
    .fill('2026-10-13');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    page.getByText('Не удалось сохранить изменения. Попробуйте ещё раз.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Вес, кг', { exact: true })).toHaveValue('42');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL('/workouts?date=2026-10-13');
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const created = (await workouts(page, id)).plans.find(
    (plan) => plan.workouts[0]?.exercises[0]?.name === exerciseName,
  )!;
  expect(created.title).toBe('');
  expect(created.workouts[0]!.title).toBe('');
  expect(created.startsOn).toBe('2026-10-13');
  expect(created.endsOn).toBe('2026-10-13');
  await expect(page.getByTestId(`plan-${created.id}`)).toContainText(
    'Тренировка · 13 октября',
  );
  const other = {
    ...created.workouts[0]!,
    id: crypto.randomUUID(),
    date: '2026-10-14',
    title: 'Другой день',
  };
  expect(
    (
      await page.request.put(
        `/api/workouts/plans/${created.id}?ownerId=${id}`,
        {
          headers: {
            origin: `http://localhost:${process.env.E2E_PORT ?? 3100}`,
          },
          data: {
            revision: created.revision,
            data: {
              title: '',
              description: '',
              startsOn: created.startsOn,
              endsOn: other.date,
              workouts: [...created.workouts, other],
            },
          },
        },
      )
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page
    .getByTestId(`plan-${created.id}`)
    .getByRole('button', { name: 'Копировать на другую дату' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Новая дата').fill('2026-10-24');
  await dialog
    .getByRole('button', { name: 'Копировать на другую дату' })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Дата', exact: true }),
  ).toHaveValue('2026-10-24');
  expect(
    (await workouts(page, id)).plans.some(
      (plan) =>
        plan.startsOn === '2026-10-24' &&
        plan.workouts[0]?.exercises[0]?.name === exerciseName,
    ),
  ).toBe(false);
  await expect(
    page.getByRole('textbox', { name: 'Упражнение', exact: true }),
  ).toHaveValue(exerciseName);
  await page.screenshot({
    path: test.info().outputPath('workout-editor.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'К тренировкам' }).click();
  await expect(page).toHaveURL('/workouts?date=2026-10-13');
  await page.goBack();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL('/workouts?date=2026-10-24');
  const copied = (await workouts(page, id)).plans.find(
    (plan) =>
      plan.startsOn === '2026-10-24' &&
      plan.workouts[0]?.exercises[0]?.name === exerciseName,
  )!;
  expect(copied.workouts).toHaveLength(1);
  expect(copied.workouts[0]!.id).not.toBe(created.workouts[0]!.id);
  expect(
    (await workouts(page, id)).sessions.filter(
      (session) => session.planId === copied.id,
    ),
  ).toHaveLength(0);
});
