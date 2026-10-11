import { test, expect, type Page, type Locator } from '@playwright/test';

async function login(page: Page, email: string) {
  const signin = () =>
    page.request.post('/api/auth/sign-in/email', {
      headers: { origin: `http://localhost:${process.env.E2E_PORT ?? 3100}` },
      data: { email, password: 'Test-only-password-12345' },
    });
  let result = await signin();
  if (result.status() === 429) {
    const seconds = Number(
      result.headers()['x-retry-after'] ??
        result.headers()['retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    result = await signin();
  }
  expect(result.ok()).toBe(true);
  return (await (await page.request.get('/api/auth/get-session')).json()).user
    .id as string;
}
async function send(panel: Locator, body: string) {
  await panel.getByLabel('Комментарий').fill(body);
  await panel.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(panel.getByText(body, { exact: true })).toBeVisible();
}

test('measurement and actual-session comments compose after CRUD with real trainer replies and revocation', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const ownerId = await login(page, 'owner@example.test');
  const trainerContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
  });
  const trainer = await trainerContext.newPage();
  trainer.on('pageerror', (error) => errors.push(error.message));
  const trainerId = await login(trainer, 'trainer@example.test');
  const scope = { ownerId, trainerId };
  expect((await page.request.post('/api/trainers', { data: scope })).ok()).toBe(
    true,
  );
  try {
    const note = `Comment UI ${test.info().project.name}`;
    await page.goto('/measurements');
    await page.getByLabel('Вес (кг)', { exact: true }).fill('72.125');
    await page.getByLabel('Заметка', { exact: true }).fill(note);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: note })).toBeVisible();
    const measurements = await (
      await page.request.get(`/api/measurements?ownerId=${ownerId}`)
    ).json();
    const measurementId = measurements.find(
      (row: { note: string }) => row.note === note,
    ).id as string;
    const measurementPanel = page.getByTestId(
      `measurement-comments-${measurementId}`,
    );
    await expect(
      measurementPanel.getByRole('heading', {
        name: 'Комментарии',
        exact: true,
      }),
    ).toBeVisible();
    await send(measurementPanel, 'Owner measurement comment');
    await page
      .getByRole('row')
      .filter({ hasText: note })
      .getByRole('button', { name: 'Изменить', exact: true })
      .click();
    await page.getByLabel('Вес (кг)', { exact: true }).fill('71.5');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(
      measurementPanel.getByText('Owner measurement comment', { exact: true }),
    ).toBeVisible();

    await page.goto('/workouts');
    await page
      .getByRole('button', { name: 'Записать тренировку', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Название тренировки').fill(note);
    await dialog.getByLabel('Упражнение 1').fill('Synthetic squat');
    await dialog
      .getByRole('button', { name: 'Сохранить', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('tab', { name: 'История', exact: true }).click();
    const data = (
      await (await page.request.get(`/api/workouts?ownerId=${ownerId}`)).json()
    ).data;
    const workoutId = data.sessions.find(
      (row: { title: string }) => row.title === note,
    ).id as string;
    await send(
      page.getByTestId(`session-${workoutId}`),
      'Owner workout comment',
    );
    await page.getByRole('tab', { name: 'Планы', exact: true }).click();
    await expect(
      page
        .locator('[role=tabpanel]:visible')
        .getByRole('heading', { name: 'Комментарии', exact: true }),
    ).toHaveCount(0);

    for (const target of [
      {
        type: 'measurement',
        id: measurementId,
        route: '/measurements',
        testId: `measurement-comments-${measurementId}`,
        text: 'Owner measurement comment',
      },
      {
        type: 'workout',
        id: workoutId,
        route: '/workouts',
        testId: `session-${workoutId}`,
        text: 'Owner workout comment',
      },
    ]) {
      await trainer.goto(target.route);
      if (target.type === 'workout')
        await trainer
          .getByRole('tab', { name: 'История', exact: true })
          .click();
      const panel = trainer.getByTestId(target.testId);
      const root = panel.getByText(target.text, { exact: true }).locator('..');
      await expect(
        root.getByRole('button', { name: 'Изменить', exact: true }),
      ).toHaveCount(0);
      await expect(
        root.getByRole('button', { name: 'Удалить', exact: true }),
      ).toHaveCount(0);
      const q = new URLSearchParams({
        ownerId,
        type: target.type,
        targetId: target.id,
      });
      const rows = await (
        await trainer.request.get(`/api/comments?${q}`)
      ).json();
      const rootId = rows.find(
        (row: { body: string }) => row.body === target.text,
      ).id;
      expect(
        (
          await trainer.request.patch(`/api/comments/${rootId}`, {
            data: { ownerId, body: 'Hijack' },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await trainer.request.get(
            `/api/comments?${new URLSearchParams({ ownerId: 'foreign', type: target.type, targetId: target.id })}`,
          )
        ).status(),
      ).toBe(403);
      await root.getByRole('button', { name: 'Ответить', exact: true }).click();
      const reply = `Trainer reply ${target.type}`;
      await send(panel, reply);
      await panel
        .getByText(reply, { exact: true })
        .locator('..')
        .getByRole('button', { name: 'Изменить', exact: true })
        .click();
      await panel.getByLabel('Комментарий').fill(`${reply} edited`);
      await panel
        .getByRole('button', { name: 'Сохранить', exact: true })
        .click();
      await expect(
        panel.getByText(`${reply} edited`, { exact: true }),
      ).toBeVisible();
      expect(
        await trainer.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const persisted = await (
        await trainer.request.get(`/api/comments?${q}`)
      ).json();
      expect(
        persisted.find(
          (row: { body: string }) => row.body === `${reply} edited`,
        ).parentId,
      ).toBe(rootId);
    }
    expect(
      (await page.request.delete('/api/trainers', { data: scope })).ok(),
    ).toBe(true);
    for (const target of [
      { type: 'measurement', id: measurementId },
      { type: 'workout', id: workoutId },
    ]) {
      const q = new URLSearchParams({
        ownerId,
        type: target.type,
        targetId: target.id,
      });
      expect((await trainer.request.get(`/api/comments?${q}`)).status()).toBe(
        403,
      );
    }
    const stalePanel = trainer.getByTestId(`session-${workoutId}`);
    await stalePanel.getByLabel('Комментарий').fill('Revoked write');
    const denied = trainer.waitForResponse(
      (response) =>
        response.url().endsWith('/api/comments') &&
        response.request().method() === 'POST',
    );
    await stalePanel
      .getByRole('button', { name: 'Отправить', exact: true })
      .click();
    expect((await denied).status()).toBe(403);
    await expect(stalePanel.getByRole('alert')).toBeVisible();
    await expect(
      stalePanel.getByText('Revoked write', { exact: true }),
    ).toHaveCount(0);
    await page.goto('/measurements');
    const measurementRow = page.getByRole('row').filter({ hasText: note });
    await measurementRow
      .getByRole('button', { name: 'Удалить', exact: true })
      .click();
    await measurementRow
      .getByRole('button', { name: 'Подтвердить удаление', exact: true })
      .click();
    await expect(
      page.getByTestId(`measurement-comments-${measurementId}`),
    ).toHaveCount(0);
    await page.goto('/workouts');
    await page.getByRole('tab', { name: 'История', exact: true }).click();
    await page
      .getByTestId(`session-${workoutId}`)
      .getByRole('button', { name: 'Удалить', exact: true })
      .first()
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Подтвердить удаление', exact: true })
      .click();
    await expect(page.getByTestId(`session-${workoutId}`)).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete('/api/trainers', { data: scope });
    await trainerContext.close();
  }
});
