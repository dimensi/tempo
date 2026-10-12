import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { meals, nutritionDaySchema } from '@/contracts/nutrition';
test('real invited trainer login, owner grant revocation and direct API isolation', async ({
  page,
  browser,
  request,
}) => {
  const nutritionDate = new Date(
    Date.UTC(
      2026,
      0,
      1 + (test.info().project.name === 'mobile' ? 10 : 0) + test.info().retry,
    ),
  )
    .toISOString()
    .slice(0, 10);
  expect((await request.get('/api/trainers?ownerId=foreign')).status()).toBe(
    401,
  );
  expect(
    (
      await request.post('/api/comments', {
        data: {
          ownerId: 'foreign',
          target: { type: 'nutrition_day', id: '2026-10-11' },
          body: 'intruder',
        },
      })
    ).status(),
  ).toBe(401);
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  let response = page.waitForResponse((value) =>
    value.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const signedIn = await response;
  if (signedIn.status() === 429) {
    const seconds = Number(
      signedIn.headers()['x-retry-after'] ??
        signedIn.headers()['retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    response = page.waitForResponse((value) =>
      value.url().endsWith('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await response).ok()).toBe(true);
  } else expect(signedIn.ok()).toBe(true);
  await expect(page).toHaveURL('/');
  const session = await (
    await page.request.get('/api/auth/get-session')
  ).json();
  const ownerId = session.user.id;
  expect(
    (await page.request.get('/api/trainers?ownerId=foreign')).status(),
  ).toBe(403);
  await page.goto('/settings#trainers');
  const trainerSettings = page.getByRole('main');
  await trainerSettings
    .getByRole('textbox', { name: 'Email тренера', exact: true })
    .fill(`invited-${test.info().project.name}@example.test`);
  await trainerSettings
    .getByRole('button', { name: 'Создать приглашение', exact: true })
    .click();
  const link = trainerSettings.getByRole('textbox', {
    name: 'Скопируйте ссылку приглашения',
    exact: true,
  });
  await expect(link).not.toHaveValue('');
  const url = await link.inputValue();
  const context = await browser.newContext();
  const invitePage = await context.newPage();
  await invitePage.goto(url);
  await invitePage
    .getByRole('textbox', { name: 'Имя', exact: true })
    .fill('Synthetic trainer');
  await invitePage
    .getByLabel('Пароль (от 12 символов)')
    .filter({ visible: true })
    .fill('Synthetic-password-123');
  await invitePage
    .getByRole('button', { name: 'Принять приглашение', exact: true })
    .click();
  await expect(
    invitePage.getByRole('alert').filter({ hasText: 'Аккаунт создан.' }),
  ).toBeVisible();
  expect(invitePage.url()).not.toContain('#');
  const token = new URL(url).hash.slice(1);
  expect(
    (
      await request.post('/api/trainers/invitations/accept', {
        data: {
          token,
          name: 'Escalation',
          password: 'Synthetic-password-123',
          role: 'OWNER',
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post('/api/trainers/invitations/accept', {
        data: { token, name: 'Replay', password: 'Synthetic-password-123' },
      })
    ).status(),
  ).toBe(400);
  const signIn = () =>
    context.request.post('/api/auth/sign-in/email', {
      headers: { origin: `http://localhost:${process.env.E2E_PORT ?? 3100}` },
      data: {
        email: `invited-${test.info().project.name}@example.test`,
        password: 'Synthetic-password-123',
      },
    });
  let signed = await signIn();
  if (signed.status() === 429) {
    const seconds = Number(
      signed.headers()['x-retry-after'] ??
        signed.headers()['retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    signed = await signIn();
  }
  expect(signed.ok()).toBe(true);
  const trainerSession = await (
    await context.request.get('/api/auth/get-session')
  ).json();
  expect(trainerSession.user.role).toBe('TRAINER');
  const trainerId = trainerSession.user.id;
  expect(
    (
      await context.request.post('/api/trainers', {
        data: { ownerId, trainerId },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.get(
        `/api/comments?ownerId=foreign&type=nutrition_day&targetId=2026-10-11`,
      )
    ).status(),
  ).toBe(403);
  const measurementResponse = await page.request.post(
    `/api/measurements?ownerId=${ownerId}`,
    {
      headers: { origin: `http://localhost:${process.env.E2E_PORT ?? 3100}` },
      data: {
        measuredAt: '2026-10-11',
        values: [{ metric: 'weight', value: '70.125', unit: 'kg' }],
        note: 'Synthetic comment target',
      },
    },
  );
  expect(measurementResponse.status()).toBe(201);
  const measurement = await measurementResponse.json();
  const scope = {
    ownerId,
    target: { type: 'measurement', id: measurement.id },
  };
  const create = await page.request.post('/api/comments', {
    data: { ...scope, body: 'Owner comment' },
  });
  expect(create.ok()).toBe(true);
  const root = await create.json();
  const replyResponse = await context.request.post('/api/comments', {
    data: { ...scope, parentId: root.id, body: 'Trainer reply' },
  });
  expect(replyResponse.ok()).toBe(true);
  const reply = await replyResponse.json();
  expect(
    (
      await context.request.patch(`/api/comments/${root.id}`, {
        data: { ownerId, body: 'Hijack' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.patch(`/api/comments/${reply.id}`, {
        data: { ownerId, body: 'Edited reply' },
      })
    ).ok(),
  ).toBe(true);
  const commentsUrl = `/api/comments?ownerId=${ownerId}&type=measurement&targetId=${measurement.id}`;
  const listed = await context.request.get(commentsUrl);
  expect(listed.ok()).toBe(true);
  expect(await listed.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: reply.id, body: 'Edited reply' }),
    ]),
  );
  for (const target of [
    { type: 'measurement', id: 'missing' },
    { type: 'nutrition_day', id: nutritionDate },
  ])
    expect(
      (
        await page.request.post('/api/comments', {
          data: { ownerId, target, body: 'Rejected target' },
        })
      ).status(),
    ).toBe(404);
  // Synthetic data in the same disposable DB prepared by Playwright migrations.
  const database = new Database('.data/e2e.sqlite');
  const zero = { calories: '0', protein: '0', fat: '0', carbs: '0' };
  const day = nutritionDaySchema.parse({
    date: nutritionDate,
    fetchedAt: new Date().toISOString(),
    meals: meals.map((kind) => ({
      kind,
      entries: [],
      totals: zero,
      knownTotals: zero,
      officialTotals: zero,
      delta: zero,
    })),
    totals: zero,
    knownTotals: zero,
    officialTotals: zero,
    delta: zero,
  });
  try {
    database
      .prepare(
        'INSERT INTO nutrition_days (owner_id, date, snapshot, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id,date) DO UPDATE SET snapshot=excluded.snapshot, fetched_at=excluded.fetched_at',
      )
      .run(ownerId, day.date, JSON.stringify(day), day.fetchedAt);
  } finally {
    database.close();
  }
  const nutritionScope = {
    ownerId,
    target: { type: 'nutrition_day', id: day.date },
  };
  const nutritionComment = await context.request.post('/api/comments', {
    data: { ...nutritionScope, body: 'Synthetic nutrition comment' },
  });
  expect(nutritionComment.ok()).toBe(true);
  const nutritionCommentId = (await nutritionComment.json()).id;
  const nutritionUrl = `/api/comments?ownerId=${ownerId}&type=nutrition_day&targetId=${day.date}`;
  expect((await context.request.get(nutritionUrl)).ok()).toBe(true);
  const daysUrl = `/api/nutrition/days?ownerId=${ownerId}&from=${day.date}&to=${day.date}`;
  const daysResponse = await context.request.get(daysUrl);
  expect(daysResponse.ok()).toBe(true);
  expect(await daysResponse.json()).toEqual([day]);
  expect((await page.request.get('/api/yazio/status')).ok()).toBe(true);
  expect((await context.request.get('/api/yazio/status')).status()).toBe(403);
  const workoutResponse = await page.request.post(
    `/api/workouts/sessions?ownerId=${ownerId}`,
    {
      headers: { origin: `http://localhost:${process.env.E2E_PORT ?? 3100}` },
      data: {
        date: '2026-10-11',
        title: 'Synthetic workout',
        exercises: [],
        status: 'skipped',
        note: '',
      },
    },
  );
  expect(workoutResponse.ok()).toBe(true);
  const workout = (await workoutResponse.json()).data;
  const workoutScope = { ownerId, target: { type: 'workout', id: workout.id } };
  const workoutComment = await page.request.post('/api/comments', {
    data: { ...workoutScope, body: 'Workout comment' },
  });
  expect(workoutComment.ok()).toBe(true);
  expect(
    (
      await page.request.delete(
        `/api/comments/${(await workoutComment.json()).id}`,
        {
          data: { ownerId },
        },
      )
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.delete('/api/trainers', {
        data: { ownerId, trainerId },
      })
    ).ok(),
  ).toBe(true);
  expect((await context.request.get(commentsUrl)).status()).toBe(403);
  expect((await context.request.get(daysUrl)).status()).toBe(403);
  expect(
    (
      await context.request.delete(`/api/comments/${nutritionCommentId}`, {
        data: { ownerId },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.delete(`/api/comments/${reply.id}`, {
        data: { ownerId },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.delete(`/api/comments/${root.id}`, {
        data: { ownerId },
      })
    ).ok(),
  ).toBe(true);
  const retained = await page.request.get(commentsUrl);
  expect(await retained.json()).toEqual([
    expect.objectContaining({ id: reply.id, parentId: null }),
  ]);
  expect(
    (
      await page.request.delete(
        `/api/measurements/${measurement.id}?ownerId=${ownerId}`,
        {
          headers: {
            origin: `http://localhost:${process.env.E2E_PORT ?? 3100}`,
          },
        },
      )
    ).status(),
  ).toBe(204);
  expect((await page.request.get(commentsUrl)).status()).toBe(404);
  expect(
    (
      await context.request.get(
        `/api/comments?ownerId=${ownerId}&type=nutrition_day&targetId=2026-10-11`,
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.post('/api/comments', {
        data: {
          ownerId,
          target: { type: 'nutrition_day', id: '2026-10-11' },
          body: 'revoked',
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.close();
});
