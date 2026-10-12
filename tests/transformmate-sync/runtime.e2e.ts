import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import type { WorkoutPlan } from '@/contracts/workouts';
import type { TransformMateSyncData } from '@/contracts/transformmate';

const origin = 'http://localhost:3157';
async function control(
  request: APIRequestContext,
  action?: string,
  id?: number,
) {
  const response = action
    ? await request.post('http://127.0.0.1:3158/control', {
        data: { action, id },
      })
    : await request.get('http://127.0.0.1:3158/control');
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    posts: unknown[];
    forbiddenWrites: number;
    reads: number;
    ids: number[];
  };
}
async function login(page: Page, role = 'owner') {
  const signIn = () =>
    page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: {
        email: `${role}@example.test`,
        password: 'Test-only-password-12345',
      },
    });
  let response = await signIn();
  if (response.status() === 429) {
    await page.waitForTimeout(
      (Number(
        response.headers()['retry-after'] ??
          response.headers()['x-retry-after'] ??
          10,
      ) +
        1) *
        1000,
    );
    response = await signIn();
  }
  expect(response.ok()).toBe(true);
  const session = await page.request.get('/api/auth/get-session');
  return (await session.json()).user.id as string;
}
function grant(ownerId: string, trainerId: string, enabled: boolean) {
  const db = new Database('.data/e2e.sqlite');
  try {
    expect(
      db.prepare('select email from user where id = ?').get(ownerId),
    ).toEqual({ email: 'owner@example.test' });
    if (enabled)
      db.prepare(
        'insert or ignore into trainer_access (owner_id, trainer_id, created_at) values (?, ?, ?)',
      ).run(ownerId, trainerId, Date.now());
    else
      db.prepare(
        'delete from trainer_access where owner_id = ? and trainer_id = ?',
      ).run(ownerId, trainerId);
  } finally {
    db.close();
  }
}
test('real cookies protect safe catalog and private synthetic ranged video', async ({
  page,
  browser,
  request,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await control(request, 'reset');
  const owner = await login(page);
  const catalog = `/api/workouts/transformmate/exercises?ownerId=${owner}`;
  const video = `/api/workouts/transformmate/exercises/501/video?ownerId=${owner}`;
  expect((await request.get(catalog)).status()).toBe(401);
  const list = await page.request.get(catalog);
  expect(list.ok()).toBe(true);
  expect(await list.json()).toMatchObject({
    data: { items: [{ id: 501, canPlan: true }] },
  });
  expect(await list.text()).not.toMatch(/kinescope|sign=|synthetic-id-token/);
  const detail = await page.request.get(
    `/api/workouts/transformmate/exercises/501?ownerId=${owner}`,
  );
  expect(await detail.json()).toMatchObject({ data: { hasVideo: true } });
  expect(await detail.text()).not.toContain('sign=');
  expect((await request.get(video)).status()).toBe(401);
  expect(
    (await page.request.get(video.replace(owner, 'foreign'))).status(),
  ).toBe(403);
  const head = await page.request.head(video);
  expect(head.status()).toBe(200);
  expect(head.headers()['content-type']).toBe('video/mp4');
  const partial = await page.request.get(video, {
    headers: { range: 'bytes=0-31' },
  });
  expect(partial.status()).toBe(206);
  expect((await partial.body()).length).toBe(32);
  expect(partial.headers()['content-range']).toMatch(/^bytes 0-31\//);
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Создать план', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Поиск упражнений TransformMate').fill('Demo');
  await dialog
    .getByRole('button', { name: 'Demo exercise', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Показать обучающее видео' })
    .click();
  const player = dialog.locator('video');
  await expect(player).toHaveCount(1);
  expect(await player.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await dialog.locator('.vjs-big-play-button').click();
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  await player.evaluate((v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = 2;
    v.playbackRate = 1.5;
  });
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThanOrEqual(2);
  expect(await player.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(
    1.5,
  );
  await expect(dialog.locator('button.vjs-playback-rate')).toBeVisible();
  await expect(dialog.locator('.vjs-fullscreen-control')).toBeVisible();
  for (const selector of [
    'button.vjs-playback-rate',
    '.vjs-fullscreen-control',
    '.vjs-play-control',
    '.vjs-progress-control',
  ]) {
    const bounds = await dialog.locator(selector).boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  await dialog.locator('button.vjs-playback-rate').click();
  await dialog.getByRole('menuitemradio', { name: '2x', exact: true }).click();
  expect(await player.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(
    2,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await dialog.locator('.vjs-fullscreen-control').click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await dialog.locator('.vjs-fullscreen-control').click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(false);
  await page.screenshot({
    path: test.info().outputPath('synthetic-video.png'),
    fullPage: false,
  });
  await dialog.getByRole('button', { name: 'Скрыть видео' }).click();
  await expect(player).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  const context = await browser.newContext();
  try {
    const trainer = await context.newPage();
    const trainerId = await login(trainer, 'trainer');
    expect((await trainer.request.get(video)).status()).toBe(403);
    grant(owner, trainerId, true);
    expect((await trainer.request.head(video)).status()).toBe(200);
    await control(request, 'cachedauthdelay');
    const inFlight = trainer.request.get(catalog);
    await page.waitForTimeout(100);
    grant(owner, trainerId, false);
    expect((await inFlight).status()).toBe(403);
    expect((await trainer.request.get(video)).status()).toBe(403);
    await request.post('http://127.0.0.1:3158/control', {
      data: { action: 'cachedauthdelay', delay: 0 },
    });
  } finally {
    await context.close();
  }
  expect((await control(request)).forbiddenWrites).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('saving creates once, retry is durable, refresh retains planned and actual history without remote edits', async ({
  page,
  request,
}) => {
  await control(request, 'reset');
  const owner = await login(page);
  const scope = `ownerId=${owner}`;
  const data = {
    title: `Synthetic ${randomUUID()}`,
    description: '',
    startsOn: '2026-01-01',
    endsOn: '2026-01-01',
    workouts: [
      {
        id: randomUUID(),
        date: '2026-01-01',
        title: 'Synthetic workout',
        exercises: [
          {
            name: 'Demo exercise',
            transformMate: { exerciseId: 501, occurrenceKey: randomUUID() },
            sets: [{ weightKg: 10, reps: 8 }],
          },
        ],
      },
    ],
  };
  const headers = { origin, 'idempotency-key': randomUUID() };
  expect(
    (
      await page.request.post(`/api/workouts/plans?${scope}`, { data })
    ).status(),
  ).toBe(403);
  const create = await page.request.post(`/api/workouts/plans?${scope}`, {
    data,
    headers,
  });
  expect(create.ok()).toBe(true);
  const plan = (await create.json()).data as WorkoutPlan;
  const retry = await page.request.post(`/api/workouts/plans?${scope}`, {
    data,
    headers,
  });
  expect(retry.ok()).toBe(true);
  expect((await retry.json()).data.id).toBe(plan.id);
  const before = await control(request);
  expect(before.posts).toHaveLength(1);
  const update = await page.request.put(
    `/api/workouts/plans/${plan.id}?${scope}`,
    {
      headers: { origin },
      data: {
        revision: plan.revision,
        data: {
          ...data,
          workouts: data.workouts.map((w) => ({
            ...w,
            title: 'Locally edited workout',
          })),
        },
      },
    },
  );
  expect(update.ok()).toBe(true);
  const updated = (await update.json()).data as WorkoutPlan;
  const conflict = await page.request.get(
    `/api/workouts/transformmate?${scope}`,
  );
  expect(
    (await conflict.json()).data.items.find(
      (i: { planId: string }) => i.planId === plan.id,
    ),
  ).toMatchObject({ status: 'conflict', reason: 'plan_changed' });
  await control(request, 'setfact', before.ids[0]);
  const refresh = await page.request.post(
    `/api/workouts/transformmate?${scope}`,
    { headers: { origin }, data: {} },
  );
  expect(refresh.ok()).toBe(true);
  const read = async () =>
    (
      await (
        await page.request.get(`/api/workouts/transformmate?${scope}`)
      ).json()
    ).data as TransformMateSyncData;
  const item = (await read()).items.find((s) => s.planId === plan.id)!;
  expect(item.status).toBe('started');
  expect(
    item.actual!.exercises[0]!.sets[0]!.metrics.map((m) => m.values),
  ).toEqual([['12.5'], ['7']]);
  expect(item.planSnapshot.workout.exercises[0]!.sets[0]).toEqual({
    reps: 8,
    weightKg: 10,
  });
  const startedEdit = await page.request.put(
    `/api/workouts/plans/${plan.id}?${scope}`,
    {
      headers: { origin },
      data: {
        revision: updated.revision,
        data: { ...data, title: 'Edited after remote start' },
      },
    },
  );
  expect(startedEdit.ok()).toBe(true);
  const startedPlan = (await startedEdit.json()).data as WorkoutPlan;
  const startedItem = (await read()).items.find((s) => s.id === item.id)!;
  expect(startedItem).toMatchObject({
    status: 'started',
    reason: 'remote_started',
    actual: item.actual,
  });
  const remove = await page.request.delete(
    `/api/workouts/plans/${plan.id}?${scope}`,
    {
      headers: { origin },
      data: { revision: startedPlan.revision },
    },
  );
  expect(remove.ok()).toBe(true);
  expect((await read()).items.find((s) => s.id === item.id)).toEqual(
    startedItem,
  );
  expect((await control(request)).posts).toHaveLength(1);
  expect((await control(request)).forbiddenWrites).toBe(0);
});

test('ambiguous creates never repeat, recovery verifies committed writes and preserves manual records', async ({
  page,
  request,
}) => {
  await control(request, 'reset');
  const owner = await login(page);
  const scope = `ownerId=${owner}`;
  const makePlan = (linked: boolean) => ({
    title: `Synthetic ${randomUUID()}`,
    description: '',
    startsOn: '2026-01-01',
    endsOn: '2026-01-01',
    workouts: [
      {
        id: randomUUID(),
        date: '2026-01-01',
        title: 'Synthetic workout',
        exercises: [
          {
            name: 'Demo exercise',
            ...(linked
              ? {
                  transformMate: {
                    exerciseId: 501,
                    occurrenceKey: randomUUID(),
                  },
                }
              : {}),
            sets: [{ reps: 8, weightKg: 10 }],
          },
        ],
      },
    ],
  });
  const create = async (data: ReturnType<typeof makePlan>) => {
    const response = await page.request.post(`/api/workouts/plans?${scope}`, {
      headers: { origin, 'idempotency-key': randomUUID() },
      data,
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).data as WorkoutPlan;
  };
  const manual = await create(makePlan(false));
  const manualSession = await page.request.post(
    `/api/workouts/sessions?${scope}`,
    {
      headers: { origin },
      data: {
        date: '2026-01-01',
        title: 'Manual actual',
        note: 'Keep this',
        status: 'completed',
        exercises: [
          { name: 'Manual exercise', sets: [{ reps: 4, weightKg: null }] },
        ],
      },
    },
  );
  expect(manualSession.ok()).toBe(true);
  const savedSession = (await manualSession.json()).data;
  expect((await control(request)).posts).toHaveLength(0);
  await control(request, 'failaftercommit');
  const committed = await create(makePlan(true));
  await control(request, 'createunknown');
  const uncommitted = await create(makePlan(true));
  expect((await control(request)).posts).toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    const response = await page.request.post(
      `/api/workouts/transformmate?${scope}`,
      { headers: { origin }, data: {} },
    );
    expect(response.ok()).toBe(true);
    const sync = (await response.json()).data as TransformMateSyncData;
    expect(
      sync.items.find((item) => item.planId === committed.id),
    ).toMatchObject({ status: 'synced' });
    expect(
      sync.items.find((item) => item.planId === uncommitted.id),
    ).toMatchObject({
      status: 'unknown',
      reason: 'ambiguous_write',
      remoteTrainingId: null,
    });
  }
  const local = (
    await (await page.request.get(`/api/workouts?${scope}`)).json()
  ).data;
  expect(local.plans.find((p: { id: string }) => p.id === manual.id)).toEqual(
    manual,
  );
  expect(
    local.sessions.find((s: { id: string }) => s.id === savedSession.id),
  ).toEqual(savedSession);
  const counters = await control(request);
  expect(counters.posts).toHaveLength(2);
  expect(counters.forbiddenWrites).toBe(0);
});
