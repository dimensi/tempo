import { test, expect } from '@playwright/test';
test('real invited trainer login, owner grant revocation and direct API isolation', async ({
  page,
  browser,
  request,
}) => {
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
  await page.goto('/settings/trainers');
  await page
    .getByLabel('Email тренера')
    .fill(`invited-${test.info().project.name}@example.test`);
  await page.getByRole('button', { name: 'Создать приглашение' }).click();
  const link = page.getByLabel('Скопируйте ссылку приглашения');
  await expect(link).not.toHaveValue('');
  const url = await link.inputValue();
  const context = await browser.newContext();
  const invitePage = await context.newPage();
  await invitePage.goto(url);
  await invitePage.getByLabel('Имя').fill('Synthetic trainer');
  await invitePage
    .getByLabel('Пароль (от 12 символов)')
    .fill('Synthetic-password-123');
  await invitePage.getByRole('button', { name: 'Принять приглашение' }).click();
  await expect(
    invitePage.getByText('Аккаунт создан.', { exact: false }),
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
      headers: { origin: 'http://localhost:3100' },
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
    { type: 'nutrition_day', id: '2026-10-11' },
  ])
    expect(
      (
        await page.request.post('/api/comments', {
          data: { ownerId, target, body: 'Rejected target' },
        })
      ).status(),
    ).toBe(404);
  const workoutResponse = await page.request.post(
    `/api/workouts/sessions?ownerId=${ownerId}`,
    {
      headers: { origin: 'http://localhost:3100' },
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
