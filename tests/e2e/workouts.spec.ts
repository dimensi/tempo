import { signInFixture } from '../ci/real-auth';
import { testOrigin } from '../ci/origin';
import { getSessionWith429Retry } from './auth-session';
import { test, expect, type Page } from '../ci/isolated-test';
import Database from 'better-sqlite3';
import type { WorkoutsData } from '@/contracts/workouts';
import { workoutMessages } from '@/features/workouts/messages';

async function login(page: Page, role: 'owner' | 'trainer' = 'owner') {
  return signInFixture(page, role);
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
  const dialog = page;
  await page
    .getByRole('textbox', { name: 'Название (необязательно)', exact: true })
    .fill(title);
  await page
    .getByRole('combobox', { name: 'Упражнение', exact: true })
    .fill('Приседание');
  await page
    .getByRole('option', { name: 'Добавить вручную: Приседание', exact: true })
    .click();
  await page.getByLabel('Вес, кг', { exact: true }).fill('40');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(
    /\/workouts\/plans\/[^/]+\/workouts\/[^?]+\?date=/,
  );
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
      headers: { origin: testOrigin },
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
  const card = page.getByTestId(`plan-${plan.id}`).filter({ visible: true });
  await card.getByRole('link', { name: 'Внести результаты' }).click();
  await dialog.getByRole('textbox', { name: /Факт · Вес, кг/ }).fill('35');
  await dialog.getByRole('textbox', { name: /Факт · Повторения/ }).fill('10');
  await dialog
    .getByLabel('Заметка', { exact: true })
    .fill('Фактическая нагрузка');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(/\/workouts\/sessions\/[^?]+\?date=/);
  const session = (await workouts(page, id)).sessions.find(
    (value) => value.planId === plan.id,
  )!;
  await expect(page).toHaveURL(/\/workouts\/sessions\//);
  await page.goto(
    `/workouts/plans/${plan.id}/workouts/${plan.workouts[0]!.id}?date=${plan.workouts[0]!.date}`,
  );
  await expect(card).toContainText('10 × 35 кг');
  await card.getByRole('link', { name: 'Изменить план', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Удалить тренировку/ }),
  ).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Название (необязательно)', exact: true })
    .fill(`${title} изменён`);
  await page.getByLabel('Вес, кг', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(
    /\/workouts\/plans\/[^/]+\/workouts\/[^?]+\?date=/,
  );
  const editedPlan = (await workouts(page, id)).plans.find(
    (value) => value.id === plan.id,
  )!;
  expect(
    editedPlan.workouts.find((workout) => workout.id === otherWorkout.id),
  ).toEqual(otherWorkout);
  await card
    .getByRole('button', { name: 'Удалить весь план', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Подтвердить удаление', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Удалить весь план', exact: true }),
  ).not.toBeVisible();
  await expect(page.getByRole('tab', { name: 'История' })).toHaveCount(0);
  const history = page.getByTestId(`session-${session.id}`);
  await expect(page).toHaveURL(/\/workouts\?date=/);
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
    ignoreHTTPSErrors: true,
    baseURL: testOrigin,
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
    await expect(
      trainer.getByRole('radio', { name: 'Уже выполнена', exact: true }),
    ).toBeDisabled();
    await trainer.goto('/workouts/sessions/new?date=2026-10-11');
    await expect(
      trainer.locator('#main-content').getByRole('alert'),
    ).toContainText(workoutMessages.noAccess);
    await trainer.goto('/workouts/sessions/foreign/edit?date=2026-10-11');
    await expect(
      trainer.locator('#main-content').getByRole('alert'),
    ).toContainText(workoutMessages.noAccess);
    await expect(
      trainer.getByRole('textbox', { name: 'Название (необязательно)' }),
    ).toHaveCount(0);
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
        headers: { origin: testOrigin },
        data: input,
      },
    );
    expect(created.ok()).toBe(true);
    const plan = (await created.json()).data;
    await trainer.goto(`/workouts/plans/${plan.id}/workouts/a?date=2026-10-11`);
    await expect(
      trainer.getByRole('heading', { name: 'Силовая', exact: true }),
    ).toBeVisible();
    await expect(
      trainer.getByRole('link', { name: 'Изменить план', exact: true }),
    ).toBeVisible();
    await expect(
      trainer.getByRole('link', { name: 'Внести результаты' }),
    ).toHaveCount(0);

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
            origin: testOrigin,
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
              origin: testOrigin,
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
              origin: testOrigin,
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
        headers: { origin: testOrigin },
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
              origin: testOrigin,
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
      trainer
        .getByText('Нет разрешения на доступ к тренировкам владельца.')
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(trainer.getByLabel('Название (необязательно)')).toHaveCount(0);
    await trainer.goto(`/workouts/plans/${plan.id}/workouts/a?date=2026-10-11`);
    await expect(
      trainer
        .getByText('Нет разрешения на доступ к тренировкам владельца.')
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      trainer.getByRole('heading', { name: 'Силовая', exact: true }),
    ).toHaveCount(0);
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
    .getByRole('combobox', { name: 'Упражнение', exact: true })
    .fill(exerciseName);
  await page
    .getByRole('option', {
      name: `Добавить вручную: ${exerciseName}`,
      exact: true,
    })
    .click();
  await page.getByLabel('Вес, кг', { exact: true }).fill('42');
  await page
    .getByRole('combobox', { name: 'Упражнение', exact: true })
    .fill('жим');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Вес, кг', { exact: true })).toHaveValue('42');
  await page.getByRole('button', { name: 'К тренировкам' }).click();
  await expect(page).toHaveURL(`/workouts?date=${date}`);
  await page.goBack();
  await expect(
    page.getByRole('combobox', { name: 'Упражнение', exact: true }),
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
  await expect(page).toHaveURL(
    /\/workouts\/plans\/[^/]+\/workouts\/[^?]+\?date=2026-10-13$/,
  );
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
            origin: testOrigin,
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
    page.getByRole('combobox', { name: 'Упражнение', exact: true }),
  ).toHaveValue(exerciseName);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'К тренировкам' }).click();
  await expect(page).toHaveURL('/workouts?date=2026-10-13');
  await page.goBack();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(
    /\/workouts\/plans\/[^/]+\/workouts\/[^?]+\?date=2026-10-24$/,
  );
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

test('a save settling after Back does not redirect or repeat the write', async ({
  page,
}) => {
  await login(page);
  const id = await ownerId(page);
  await page.goto('/workouts?date=2026-10-12');
  await page
    .getByRole('button', { name: 'Добавить тренировку', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Упражнение', exact: true })
    .fill('Delayed save');
  await page
    .getByRole('option', {
      name: 'Добавить вручную: Delayed save',
      exact: true,
    })
    .click();
  await page
    .getByRole('textbox', { name: 'Дата', exact: true })
    .fill('2026-10-13');
  let release!: () => void;
  let notifySaved!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved = new Promise<void>((resolve) => {
    notifySaved = resolve;
  });
  let posts = 0;
  await page.route('**/api/workouts/plans?*', async (route) => {
    posts++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    notifySaved();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await saved;
  await page.goBack();
  await expect(page).toHaveURL('/workouts?date=2026-10-12');
  release();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((key) =>
            key.startsWith('workout-draft:'),
          ).length,
      ),
    )
    .toBe(1);
  await expect(page).toHaveURL('/workouts?date=2026-10-12');
  expect(posts).toBe(1);
  expect(
    (await workouts(page, id)).plans.filter(
      (plan) => plan.workouts[0]?.exercises[0]?.name === 'Delayed save',
    ),
  ).toHaveLength(1);
});

test('result page separates plan guidance, preserves missing facts and returns to the source day after date changes', async ({
  page,
}) => {
  await login(page);
  const id = await ownerId(page);
  const sourceDate = '2026-10-15';
  const name = `Result squat ${test.info().project.name}`;
  const created = await page.request.post(`/api/workouts/plans?ownerId=${id}`, {
    headers: { origin: testOrigin },
    data: {
      title: '',
      description: '',
      startsOn: sourceDate,
      endsOn: sourceDate,
      workouts: [
        {
          id: crypto.randomUUID(),
          title: '',
          date: sourceDate,
          exercises: [{ name, sets: [{ reps: 10, weightKg: 40 }] }],
        },
      ],
    },
  });
  expect(created.ok()).toBe(true);
  const plan = (await created.json()).data;
  const resource = `/workouts/plans/${plan.id}/workouts/${plan.workouts[0].id}`;
  await page.goto(`${resource}?date=${sourceDate}`);
  await page
    .getByRole('link', { name: 'Внести результаты', exact: true })
    .click();
  await expect(page).toHaveURL(
    `${resource}/results?date=${sourceDate}&from=view`,
  );
  const reps = page.getByRole('textbox', { name: /Факт · Повторения/ });
  const weight = page.getByRole('textbox', { name: /Факт · Вес, кг/ });
  await expect(reps).toHaveValue('');
  await expect(weight).toHaveValue('');
  await expect(
    page.getByRole('columnheader', { name: 'План', exact: true }),
  ).toBeVisible();
  await weight.fill('35');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('#main-content').getByRole('alert')).toContainText(
    'Укажите целое число повторений в каждом записываемом подходе.',
  );
  expect(
    (await workouts(page, id)).sessions.some(
      (value) => value.planId === plan.id,
    ),
  ).toBe(false);
  await page
    .getByRole('button', { name: 'К тренировкам', exact: true })
    .click();
  await expect(page).toHaveURL(`${resource}?date=${sourceDate}`);
  await page.goBack();
  await expect(weight).toHaveValue('35');
  await expect(reps).toHaveValue('');
  await reps.fill('8');
  await weight.fill('');
  await page
    .getByRole('textbox', { name: 'Дата', exact: true })
    .fill('2026-10-16');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(/\/workouts\/sessions\/[^?]+\?date=2026-10-15$/);
  const session = (await workouts(page, id)).sessions.find(
    (value) => value.planId === plan.id,
  )!;
  expect(session.date).toBe('2026-10-16');
  expect(session.exercises[0]!.sets).toEqual([{ reps: 8, weightKg: null }]);
  await page
    .getByRole('link', { name: 'Изменить результаты', exact: true })
    .click();
  await expect(reps).toHaveValue('8');
  await expect(weight).toHaveValue('');
  await reps.fill('6');
  await page
    .getByRole('button', { name: 'Добавить подход', exact: true })
    .click();
  await page
    .getByRole('textbox', {
      name: `Факт · Повторения · ${name} · Подход 2`,
      exact: true,
    })
    .fill('4');
  await page
    .getByRole('textbox', {
      name: `Факт · Вес, кг · ${name} · Подход 2`,
      exact: true,
    })
    .fill('0');
  const adder = page.getByRole('combobox', {
    name: 'Добавить упражнение',
    exact: true,
  });
  await adder.click();
  await adder.fill('Extra actual');
  await page
    .getByRole('option', {
      name: 'Добавить вручную: Extra actual',
      exact: true,
    })
    .click();
  await page
    .getByRole('textbox', {
      name: 'Факт · Повторения · Extra actual · Подход 1',
      exact: true,
    })
    .fill('3');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(
    `/workouts/sessions/${session.id}?date=${sourceDate}`,
  );
  await expect(page.getByText('4 × 0 кг', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Extra actual', { exact: true }).first(),
  ).toBeVisible();
  expect(
    (await workouts(page, id)).sessions.filter(
      (value) => value.planId === plan.id,
    ),
  ).toHaveLength(1);
  await page.getByRole('link', { name: 'К тренировкам', exact: true }).click();
  await expect(page).toHaveURL(`/workouts?date=${sourceDate}`);
});

test('add choice creates performed work directly without a plan and skipped work has no invented facts', async ({
  page,
}) => {
  await login(page);
  const id = await ownerId(page);
  const before = await workouts(page, id);
  await page.goto('/workouts?date=2026-10-17');
  await page
    .getByRole('button', { name: 'Добавить тренировку', exact: true })
    .click();
  await page.getByText('Уже выполнена', { exact: true }).click();
  await expect(page).toHaveURL(
    '/workouts/sessions/new?date=2026-10-17&returnDate=2026-10-17',
  );
  await expect(
    page.getByRole('columnheader', { name: 'План', exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel('Название (необязательно)')
    .fill(`Skipped ${test.info().project.name}`);
  await page.getByRole('combobox', { name: 'Статус', exact: true }).click();
  await page.getByRole('option', { name: 'Пропущена', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(/\/workouts\/sessions\/[0-9a-f-]{36}\?date=/);
  const after = await workouts(page, id);
  expect(after.plans.map((value) => value.id)).toEqual(
    before.plans.map((value) => value.id),
  );
  const session = after.sessions.find(
    (value) => !before.sessions.some((old) => old.id === value.id),
  )!;
  expect(session.status).toBe('skipped');
  expect(session.exercises).toEqual([]);
  expect(session.planId).toBeNull();
});

test('actual draft survives conflict and access errors; unavailable storage requires explicit leave', async ({
  page,
}) => {
  await login(page);
  const date = '2026-10-18';
  const route = `/workouts/sessions/new?date=${date}`;
  await page.goto(route);
  async function addExercise() {
    const input = page.getByRole('combobox', {
      name: 'Добавить упражнение',
      exact: true,
    });
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await input.fill('Draft actual');
    await expect(
      page.getByRole('option', {
        name: 'Добавить вручную: Draft actual',
        exact: true,
      }),
    ).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Enter');
  }
  await addExercise();
  const reps = page.getByRole('textbox', { name: /Факт · Повторения/ });
  await reps.fill('7');
  await page.route('**/api/offline/writes', (handler) =>
    handler.request().method() === 'POST'
      ? handler.fulfill({ status: 409, json: { error: 'conflict' } })
      : handler.continue(),
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const queued = page.locator('[data-offline-write-private]');
  await expect(
    queued.getByText('Нужна проверка', { exact: true }),
  ).toBeVisible();
  await expect(queued).toContainText('Draft actual');
  await expect(queued).toContainText('× 7');
  await queued
    .getByRole('button', { name: 'Оставить серверный вариант', exact: true })
    .click();
  await page.unroute('**/api/offline/writes');
  await page.goto(route);
  await addExercise();
  await reps.fill('7');
  await page.route('**/api/workouts?*', (handler) =>
    handler.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.reload();
  await expect(page.locator('#main-content').getByRole('alert')).toContainText(
    'загрузить',
  );
  await page.unroute('**/api/workouts?*');
  await page
    .getByRole('button', { name: 'Обновить данные', exact: true })
    .click();
  await expect(reps).toHaveValue('7');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw Error('storage disabled');
    };
  });
  await reps.fill('9');
  await expect(
    page.getByText('Черновик сохранён в этой вкладке.', { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'К тренировкам', exact: true })
    .click();
  const confirmation = page.getByRole('dialog');
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole('button', { name: 'Продолжить редактирование', exact: true })
    .click();
  await expect(reps).toHaveValue('9');
  await page.getByText('Запланировать', { exact: true }).click();
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole('button', { name: 'Удалить черновик', exact: true })
    .click();
  await expect(page).toHaveURL(`/workouts/new?date=${date}&returnDate=${date}`);
});

test('late actual save cannot erase a reopened draft or redirect it', async ({
  page,
}) => {
  await login(page);
  const id = await ownerId(page);
  const path = '/workouts/sessions/new?date=2026-10-19';
  await page.goto(path);
  async function addExercise() {
    const exerciseInput = page.getByRole('combobox', {
      name: 'Добавить упражнение',
      exact: true,
    });
    await exerciseInput.scrollIntoViewIfNeeded();
    await exerciseInput.click();
    await exerciseInput.fill('Delayed actual');
    await expect(
      page.getByRole('option', {
        name: 'Добавить вручную: Delayed actual',
        exact: true,
      }),
    ).toBeVisible();
    await exerciseInput.press('ArrowDown');
    await exerciseInput.press('Enter');
  }
  await addExercise();
  const reps = page.getByRole('textbox', { name: /Факт · Повторения/ });
  await reps.fill('6');
  let release!: () => void,
    notifySaved!: () => void,
    notifySettled!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved = new Promise<void>((resolve) => {
    notifySaved = resolve;
  });
  const settled = new Promise<void>((resolve) => {
    notifySettled = resolve;
  });
  let posts = 0;
  await page.route('**/api/offline/writes', async (handler) => {
    if (handler.request().method() !== 'POST') return handler.continue();
    posts++;
    const response = await handler.fetch();
    expect(response.ok()).toBe(true);
    notifySaved();
    await gate;
    try {
      await handler.fulfill({ response });
    } finally {
      notifySettled();
    }
  });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await saved;
  await expect(reps).toBeDisabled();
  await expect(
    page.getByRole('radio', { name: 'Запланировать', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'К тренировкам', exact: true }),
  ).toBeDisabled();
  await page.goBack();
  await page.goto(path);
  await expect(reps).toHaveCount(0);
  await addExercise();
  await reps.fill('9');
  release();
  await settled;
  await expect(page).toHaveURL(path);
  await expect(reps).toHaveValue('9');
  const stored = await page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.includes(':session:'))
      .map(([, value]) => JSON.parse(value)),
  );
  expect(stored[0].value.exercises[0].sets[0].reps).toBe(9);
  expect(posts).toBe(1);
  expect(
    (await workouts(page, id)).sessions.filter(
      (value) => value.exercises[0]?.name === 'Delayed actual',
    ),
  ).toHaveLength(1);
});

test('retained planned and actual editors hide cached drafts before real access revalidation and denial', async ({
  browser,
}) => {
  const baseURL = testOrigin;
  for (const kind of ['planned', 'actual'] as const) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      baseURL,
    });
    const page = await context.newPage();
    const database = new Database('.data/e2e.sqlite', { fileMustExist: true });
    let release = () => {};
    let currentSession: string | undefined;
    try {
      await login(page);
      const id = await ownerId(page);
      currentSession = (
        await (await page.request.get('/api/auth/get-session')).json()
      ).session.id as string;
      const date = '2026-10-20';
      await page.goto(`/workouts?date=${date}`);
      await page
        .getByRole('button', { name: 'Добавить тренировку', exact: true })
        .click();
      if (kind === 'actual') {
        await page.getByText('Уже выполнена', { exact: true }).click();
        await expect(page).toHaveURL(
          `/workouts/sessions/new?date=${date}&returnDate=${date}`,
        );
      } else await expect(page).toHaveURL(`/workouts/new?date=${date}`);
      await page
        .getByLabel('Название (необязательно)')
        .fill(`Private ${kind} draft`);
      await expect(
        page.getByText(workoutMessages.draftSaved, { exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: workoutMessages.back, exact: true })
        .click();
      await expect(page).toHaveURL(`/workouts?date=${date}`);
      await expect(
        page.getByRole('heading', {
          name: workoutMessages.emptyDay,
          exact: true,
        }),
      ).toBeVisible();
      let started!: () => void;
      const probeStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/workouts?*', async (route) => {
        started();
        await gate;
        await route.continue();
      });
      await page.goBack();
      await probeStarted;
      // This is the retained client page, before denial or any server-page redirect.
      await expect(
        page.getByRole('textbox', {
          name: 'Название (необязательно)',
          exact: true,
        }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            Object.keys(sessionStorage).filter((key) =>
              key.startsWith('workout-draft:'),
            ).length,
        ),
      ).toBe(1);
      const response = page.waitForResponse(
        (value) =>
          value.url().includes('/api/workouts?') &&
          value.request().method() === 'GET',
      );
      expect(
        database
          .prepare('UPDATE session SET expires_at = 0 WHERE id = ?')
          .run(currentSession).changes,
      ).toBe(1);
      release();
      expect((await response).status()).toBe(401);
      await expect(
        page.locator('#main-content').getByRole('alert'),
      ).toContainText('Доступ изменился.');
      await expect(
        page.getByRole('textbox', {
          name: 'Название (необязательно)',
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Сохранить', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText(workoutMessages.draftSaved, { exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            Object.keys(sessionStorage).filter((key) =>
              key.startsWith('workout-draft:'),
            ).length,
        ),
      ).toBe(0);
      expect(
        (
          await page.request.post(
            `/api/workouts/${kind === 'actual' ? 'sessions' : 'plans'}?ownerId=${id}`,
            { headers: { origin: baseURL }, data: {} },
          )
        ).status(),
      ).toBe(401);
    } finally {
      release();
      if (currentSession)
        database
          .prepare('DELETE FROM session WHERE id = ?')
          .run(currentSession);
      database.close();
      await context.close();
    }
  }
});
