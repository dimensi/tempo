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
  const result = await page.request.get('/api/auth/get-session');
  return (await result.json()).user.id as string;
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
  await page.getByRole('button', { name: 'Создать план', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Название плана', exact: true })
    .fill(title);
  await dialog
    .getByRole('textbox', { name: 'Название тренировки 1', exact: true })
    .fill('Силовая');
  await dialog
    .getByRole('textbox', { name: 'Упражнение 1', exact: true })
    .fill('Приседание');
  await dialog.getByLabel('Вес, кг 1.1', { exact: true }).fill('40');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const plan = (await workouts(page, id)).plans.find(
    (value) => value.title === title,
  )!;
  const card = page.getByTestId(`plan-${plan.id}`);
  await card.getByRole('button', { name: 'Записать результат' }).click();
  await dialog.getByLabel('Вес, кг 1.1', { exact: true }).fill('35');
  await dialog
    .getByLabel('Заметка', { exact: true })
    .fill('Фактическая нагрузка');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const session = (await workouts(page, id)).sessions.find(
    (value) => value.planId === plan.id,
  )!;
  await card
    .getByRole('button', { name: 'Редактировать', exact: true })
    .click();
  await dialog
    .getByRole('textbox', { name: 'Название плана', exact: true })
    .fill(`${title} изменён`);
  await dialog.getByLabel('Вес, кг 1.1', { exact: true }).fill('60');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await card.getByRole('button', { name: 'Удалить', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Подтвердить удаление', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('tab', { name: 'История' }).click();
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
    baseURL: 'http://localhost:3100',
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
      trainer.getByRole('button', { name: 'Создать план', exact: true }),
    ).toBeVisible();
    await expect(
      trainer.getByRole('button', { name: 'Записать тренировку', exact: true }),
    ).toHaveCount(0);
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
      { headers: { origin: 'http://localhost:3100' }, data: input },
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
          headers: { origin: 'http://localhost:3100' },
          data: actual,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await trainer.request.put(
          `/api/workouts/sessions/anything?ownerId=${id}`,
          {
            headers: { origin: 'http://localhost:3100' },
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
            headers: { origin: 'http://localhost:3100' },
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
        headers: { origin: 'http://localhost:3100' },
        data: { revision: 1, data: { ...input, title: 'Исправленный план' } },
      },
    );
    expect(updated.ok()).toBe(true);
    expect(
      (
        await trainer.request.put(
          `/api/workouts/plans/${plan.id}?ownerId=${id}`,
          {
            headers: { origin: 'http://localhost:3100' },
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
  } finally {
    database
      .prepare('DELETE FROM trainer_access WHERE trainer_id = ?')
      .run(trainerId.id);
    database.close();
    await context.close();
  }
});
