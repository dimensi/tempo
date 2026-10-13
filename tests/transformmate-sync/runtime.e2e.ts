import { getSessionWith429Retry } from '../e2e/auth-session';
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import type { WorkoutPlan, WorkoutPlanInput } from '@/contracts/workouts';
import type { TransformMateSyncData } from '@/contracts/transformmate';
import { transformMateConnectionStatusSchema } from '@/contracts/transformmate-connection';

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
    patches: { id: number; body: unknown }[];
    forbiddenWrites: number;
    reads: number;
    ids: number[];
    activeReads: number;
    firebaseTokens: string[];
    trainings: ReturnType<
      typeof import('../fixtures/transformmate').trainingDetailFixture
    >[];
  };
}
const credentials = {
  apiKey: 'synthetic-api-key',
  refreshToken: 'synthetic-refresh-token',
};
const tokenFile = './.data/e2e-transformmate-token.json';
async function connect(page: Page) {
  const response = await page.request.post('/api/transformmate/connect', {
    headers: { origin },
    data: credentials,
  });
  expect(response.ok()).toBe(true);
  const status = transformMateConnectionStatusSchema.parse(
    (await response.json()).data,
  );
  expect(status).toMatchObject({
    configured: true,
    account: {
      id: 201,
      name: 'Synthetic Athlete',
      email: 'synthetic@example.test',
    },
  });
  expect(await response.text()).not.toMatch(
    /synthetic-api-key|synthetic-refresh-token|synthetic-id-token/,
  );
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
  return (await getSessionWith429Retry(page.request)).user.id;
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
test('owner connects through masked settings, persists rotation, rejects wrong binding, and disconnect fences in-flight checks', async ({
  page,
  browser,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await control(request, 'reset');
  const owner = await login(page);
  const mutate = (action: string, data: unknown = {}) =>
    page.request.post(`/api/transformmate/${action}`, {
      headers: { origin },
      data,
    });
  expect((await request.get('/api/transformmate/status')).status()).toBe(401);
  expect(
    (
      await request.post('/api/transformmate/connect', {
        headers: { origin },
        data: credentials,
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post('/api/transformmate/connect', {
        data: credentials,
      })
    ).status(),
  ).toBe(403);
  expect((await mutate('disconnect')).ok()).toBe(true);
  const initialStatus = page.waitForResponse((response) =>
    response.url().endsWith('/api/transformmate/status'),
  );
  await page.goto('/settings#transformmate');
  expect((await initialStatus).ok()).toBe(true);
  const connectionSection = page.locator('#transformmate');
  const apiKey = connectionSection.getByLabel('Firebase API key');
  const refreshToken = connectionSection.getByLabel('Firebase refresh token');
  await expect(apiKey).toHaveAttribute('type', 'password');
  await expect(refreshToken).toHaveAttribute('type', 'password');
  await expect(
    connectionSection.getByRole('button', { name: 'Подключить', exact: true }),
  ).toBeEnabled();
  await apiKey.fill(credentials.apiKey);
  await expect(apiKey).toBeEditable();
  await expect(refreshToken).toBeEditable();
  await refreshToken.fill('synthetic-refresh-token-rejected');
  await expect(apiKey).toHaveValue(credentials.apiKey);
  await expect(refreshToken).toHaveValue('synthetic-refresh-token-rejected');
  const rejected = page.waitForResponse((r) =>
    r.url().endsWith('/api/transformmate/connect'),
  );
  await connectionSection
    .getByRole('button', { name: 'Подключить', exact: true })
    .click();
  expect((await rejected).status()).toBe(502);
  await expect(apiKey).toHaveValue('');
  await expect(refreshToken).toHaveValue('');
  await expect(connectionSection.getByRole('alert')).toBeVisible();
  expect(await connectionSection.textContent()).not.toMatch(
    /synthetic-api-key|synthetic-refresh-token/,
  );
  await apiKey.fill(credentials.apiKey);
  await refreshToken.fill(credentials.refreshToken);
  const connected = page.waitForResponse((r) =>
    r.url().endsWith('/api/transformmate/connect'),
  );
  await connectionSection
    .getByRole('button', { name: 'Подключить', exact: true })
    .click();
  expect((await connected).ok()).toBe(true);
  await expect(
    page.getByText('Synthetic Athlete', { exact: true }),
  ).toBeVisible();
  const checked = page.waitForResponse((r) =>
    r.url().endsWith('/api/transformmate/check'),
  );
  await connectionSection
    .getByRole('button', { name: 'Проверить подключение', exact: true })
    .click();
  expect((await checked).ok()).toBe(true);
  await expect
    .poll(() =>
      page
        .locator('input')
        .evaluateAll((inputs) =>
          inputs.every(
            (i) => !(i as HTMLInputElement).value.includes('synthetic-'),
          ),
        ),
    )
    .toBe(true);
  const status = transformMateConnectionStatusSchema.parse(
    (await (await page.request.get('/api/transformmate/status')).json()).data,
  );
  expect(status).toMatchObject({ configured: true, account: { id: 201 } });
  const encrypted = readFileSync(tokenFile, 'utf8');
  expect(encrypted).not.toMatch(
    /synthetic-api-key|synthetic-refresh-token|synthetic-user|synthetic@example/,
  );
  expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toMatch(/synthetic-api-key|synthetic-refresh-token/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await connectionSection.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath('synthetic-connection.png'),
    fullPage: false,
  });
  const failed = await mutate('connect', {
    ...credentials,
    refreshToken: 'synthetic-refresh-token-rejected',
  });
  expect(failed.status()).toBe(502);
  expect(await failed.text()).not.toMatch(/synthetic-|INVALID_REFRESH_TOKEN/);
  expect(readFileSync(tokenFile, 'utf8')).toBe(encrypted);
  const beforeForbidden = (await control(request)).firebaseTokens.length;
  expect(
    (
      await mutate('connect', {
        ...credentials,
        apiKey: 'synthetic-forbidden-key',
      })
    ).status(),
  ).toBe(502);
  expect((await control(request)).firebaseTokens).toHaveLength(beforeForbidden);
  expect(readFileSync(tokenFile, 'utf8')).toBe(encrypted);
  await control(request, 'rotate');
  expect((await mutate('check')).ok()).toBe(true);
  expect((await mutate('check')).ok()).toBe(true);
  expect((await control(request)).firebaseTokens).toContain(
    'synthetic-refresh-token-rotated',
  );
  expect(readFileSync(tokenFile, 'utf8')).not.toBe(encrypted);
  expect(readFileSync(tokenFile, 'utf8')).not.toContain(
    'synthetic-refresh-token-rotated',
  );
  const linked = await page.request.post(
    `/api/workouts/plans?ownerId=${owner}`,
    {
      headers: { origin, 'idempotency-key': randomUUID() },
      data: {
        title: `Binding ${randomUUID()}`,
        description: '',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
        workouts: [
          {
            id: randomUUID(),
            date: '2026-01-01',
            title: 'Binding workout',
            exercises: [
              {
                name: 'Demo exercise',
                transformMate: { exerciseId: 501, occurrenceKey: randomUUID() },
                sets: [{ reps: 8, weightKg: 10 }],
              },
            ],
          },
        ],
      },
    },
  );
  expect(linked.ok()).toBe(true);
  const beforeWrongAccount = readFileSync(tokenFile, 'utf8');
  const wrong = await mutate('connect', {
    ...credentials,
    refreshToken: 'synthetic-refresh-token-other',
  });
  expect(wrong.status()).toBe(409);
  expect(await wrong.json()).toMatchObject({ errorCode: 'account_mismatch' });
  expect(readFileSync(tokenFile, 'utf8')).toBe(beforeWrongAccount);
  const context = await browser.newContext();
  try {
    const trainer = await context.newPage();
    const trainerId = await login(trainer, 'trainer');
    grant(owner, trainerId, true);
    expect(
      (await trainer.request.get('/api/transformmate/status')).status(),
    ).toBe(403);
    for (const action of ['connect', 'check', 'disconnect'])
      expect(
        (
          await trainer.request.post(`/api/transformmate/${action}`, {
            headers: { origin },
            data: action === 'connect' ? credentials : {},
          })
        ).status(),
      ).toBe(403);
    await trainer.goto('/settings');
    await expect(trainer.getByLabel('Firebase API key')).toHaveCount(0);
    await expect(trainer.getByLabel('Firebase refresh token')).toHaveCount(0);
    grant(owner, trainerId, false);
  } finally {
    await context.close();
  }
  expect(
    (
      await page.request.post('/api/auth/sign-out', {
        headers: { origin },
        data: {},
      })
    ).ok(),
  ).toBe(true);
  expect((await page.request.get('/api/transformmate/status')).status()).toBe(
    401,
  );
  expect(readFileSync(tokenFile, 'utf8')).toBe(beforeWrongAccount);
  await login(page);
  expect(
    (await (await page.request.get('/api/transformmate/status')).json()).data
      .configured,
  ).toBe(true);
  await control(request, 'cachedauthdelay');
  const checking = mutate('check');
  await expect
    .poll(async () => (await control(request)).activeReads)
    .toBeGreaterThan(0);
  expect((await mutate('disconnect')).ok()).toBe(true);
  const tombstone = readFileSync(tokenFile, 'utf8');
  expect((await checking).status()).toBe(409);
  expect(readFileSync(tokenFile, 'utf8')).toBe(tombstone);
  expect(
    (await (await page.request.get('/api/transformmate/status')).json()).data
      .configured,
  ).toBe(false);
  await request.post('http://127.0.0.1:3158/control', {
    data: { action: 'cachedauthdelay', delay: 0 },
  });
  await connect(page);
  await page.goto('/settings#transformmate');
  await connectionSection
    .getByRole('button', { name: 'Отключить', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const disconnected = page.waitForResponse((r) =>
    r.url().endsWith('/api/transformmate/disconnect'),
  );
  await dialog.getByRole('button', { name: /Отключить|Подтвердить/ }).click();
  expect((await disconnected).ok()).toBe(true);
  await expect(page.getByLabel('Firebase API key')).toHaveValue('');
  await expect(page.getByLabel('Firebase refresh token')).toHaveValue('');
  expect(
    (await (await page.request.get('/api/transformmate/status')).json()).data
      .configured,
  ).toBe(false);
  expect(errors).toEqual([]);
});

test('idle updates preserve occurrences while reordering, adding and removing exercises and sets; facts and external edits block writes', async ({
  page,
  request,
}) => {
  await control(request, 'reset');
  const owner = await login(page);
  await connect(page);
  const scope = `ownerId=${owner}&from=2026-01-01&to=2026-01-31&limit=20`;
  const exercise = (comment: string, weightKg: number) => ({
    name: 'Demo exercise',
    comment,
    transformMate: { exerciseId: 501, occurrenceKey: randomUUID() },
    sets: [
      { reps: 8, weightKg },
      { reps: 7, weightKg: weightKg + 1 },
    ],
  });
  const a = exercise('A', 10),
    b = exercise('B', 20),
    c = exercise('C', 30);
  let data: WorkoutPlanInput = {
    title: `Structure ${randomUUID()}`,
    description: '',
    startsOn: '2026-01-01',
    endsOn: '2026-01-03',
    workouts: [
      {
        id: randomUUID(),
        date: '2026-01-01',
        title: 'Initial structure',
        exercises: [a, b],
      },
    ],
  };
  const created = await page.request.post(`/api/workouts/plans?${scope}`, {
    headers: { origin, 'idempotency-key': randomUUID() },
    data,
  });
  expect(created.ok()).toBe(true);
  let plan = (await created.json()).data as WorkoutPlan;
  const initial = (await control(request)).trainings.at(-1)!;
  const remoteId = initial.id;
  const initialIds = initial.protocols[0]!.workout_exercises.map((e) => e.id);
  const update = async () => {
    const response = await page.request.put(
      `/api/workouts/plans/${plan.id}?${scope}`,
      { headers: { origin }, data: { revision: plan.revision, data } },
    );
    expect(response.ok()).toBe(true);
    plan = (await response.json()).data;
    return (
      (
        await (
          await page.request.get(`/api/workouts/transformmate?${scope}`)
        ).json()
      ).data as TransformMateSyncData
    ).items.find((item) => item.planId === plan.id)!;
  };
  data = {
    ...data,
    title: 'Updated structure plan',
    workouts: [
      {
        ...data.workouts[0]!,
        date: '2026-01-02',
        title: 'Updated structure',
        exercises: [
          { ...b, comment: 'B changed', sets: [{ reps: 5, weightKg: 25 }] },
          { ...a, sets: [{ reps: 4, weightKg: 12 }] },
        ],
      },
    ],
  };
  const reordered = await update();
  expect(reordered).toMatchObject({
    status: 'synced',
    publishedSnapshot: { planTitle: data.title, workout: data.workouts[0] },
  });
  let counters = await control(request);
  expect(counters.patches).toHaveLength(1);
  const reorderedWire = counters.trainings.find((t) => t.id === remoteId)!;
  expect(
    reorderedWire.protocols[0]!.workout_exercises.map((e) => e.id),
  ).toEqual([initialIds[1], initialIds[0]]);
  data = {
    ...data,
    workouts: [
      { ...data.workouts[0]!, exercises: [c, data.workouts[0]!.exercises[0]!] },
    ],
  };
  const replaced = await update();
  expect(replaced).toMatchObject({
    status: 'synced',
    publishedSnapshot: { workout: data.workouts[0] },
  });
  expect(replaced.planSnapshot.workout.exercises.map((e) => e.comment)).toEqual(
    ['A', 'B'],
  );
  counters = await control(request);
  expect(counters.posts).toHaveLength(1);
  expect(counters.patches).toHaveLength(2);
  const replacedWire = counters.trainings.find((t) => t.id === remoteId)!;
  expect(replacedWire.protocols[0]!.workout_exercises[1]!.id).toBe(
    initialIds[1],
  );
  expect(replacedWire.protocols[0]!.workout_exercises[0]!.id).not.toBe(
    initialIds[0],
  );
  for (const e of replacedWire.protocols[0]!.workout_exercises)
    expect(
      e.metrics
        .find((m) => m.type === 'fact')!
        .sets.every(
          (s) => s.set_metrics.length === 0 && 'is_done' in s && !s.is_done,
        ),
    ).toBe(true);
  await control(request, 'unstartedfact', remoteId);
  data = {
    ...data,
    workouts: [{ ...data.workouts[0]!, title: 'Blocked by fact' }],
  };
  expect(await update()).toMatchObject({
    status: 'conflict',
    reason: 'remote_fact',
    updateAttempt: { phase: 'conflict' },
  });
  expect((await control(request)).patches).toHaveLength(2);
  const externalData = {
    ...data,
    title: `External ${randomUUID()}`,
    workouts: [{ ...data.workouts[0]!, id: randomUUID() }],
  };
  const externalCreated = await page.request.post(
    `/api/workouts/plans?${scope}`,
    { headers: { origin }, data: externalData },
  );
  expect(externalCreated.ok()).toBe(true);
  const externalPlan = (await externalCreated.json()).data as WorkoutPlan;
  const externalId = (await control(request)).ids.at(-1)!;
  await control(request, 'externaledit', externalId);
  const externalUpdate = await page.request.put(
    `/api/workouts/plans/${externalPlan.id}?${scope}`,
    {
      headers: { origin },
      data: {
        revision: externalPlan.revision,
        data: {
          ...externalData,
          workouts: [
            { ...externalData.workouts[0]!, title: 'Local after external' },
          ],
        },
      },
    },
  );
  expect(externalUpdate.ok()).toBe(true);
  const state = (
    await (
      await page.request.get(`/api/workouts/transformmate?${scope}`)
    ).json()
  ).data as TransformMateSyncData;
  expect(
    state.items.find((item) => item.planId === externalPlan.id),
  ).toMatchObject({ status: 'conflict', reason: 'remote_changed' });
  expect((await control(request)).patches).toHaveLength(2);
  expect((await control(request)).forbiddenWrites).toBe(0);
});

test('uncertain idle PATCH never repeats or rolls back; committed responses verify and missing commits remain unknown', async ({
  page,
  request,
}) => {
  await control(request, 'reset');
  const owner = await login(page);
  await connect(page);
  const scope = `ownerId=${owner}&from=2026-01-01&to=2026-01-31&limit=20`;
  let expectedPatches = 0;
  for (const failure of ['patchaftercommit', 'patchunknown']) {
    const data: WorkoutPlanInput = {
      title: `Patch ${randomUUID()}`,
      description: '',
      startsOn: '2026-01-01',
      endsOn: '2026-01-01',
      workouts: [
        {
          id: randomUUID(),
          date: '2026-01-01',
          title: 'Before uncertain patch',
          exercises: [
            {
              name: 'Demo exercise',
              transformMate: { exerciseId: 501, occurrenceKey: randomUUID() },
              sets: [{ reps: 8, weightKg: 10 }],
            },
          ],
        },
      ],
    };
    const created = await page.request.post(`/api/workouts/plans?${scope}`, {
      headers: { origin },
      data,
    });
    expect(created.ok()).toBe(true);
    const plan = (await created.json()).data as WorkoutPlan;
    await control(request, failure);
    const changed = {
      ...data,
      workouts: [{ ...data.workouts[0]!, title: 'After uncertain patch' }],
    };
    const updated = await page.request.put(
      `/api/workouts/plans/${plan.id}?${scope}`,
      { headers: { origin }, data: { revision: plan.revision, data: changed } },
    );
    expect(updated.ok()).toBe(true);
    expectedPatches++;
    for (let i = 0; i < 2; i++) {
      const refreshed = await page.request.post(
        `/api/workouts/transformmate?${scope}`,
        { headers: { origin }, data: {} },
      );
      expect(refreshed.ok()).toBe(true);
      const item = (
        (await refreshed.json()).data as TransformMateSyncData
      ).items.find((item) => item.planId === plan.id)!;
      expect(item.status).toBe(
        failure === 'patchaftercommit' ? 'synced' : 'unknown',
      );
      expect(item.updateAttempt?.phase).toBe(
        failure === 'patchaftercommit' ? 'verified' : 'unknown',
      );
      expect(item.publishedSnapshot!.workout.title).toBe(
        failure === 'patchaftercommit'
          ? 'After uncertain patch'
          : 'Before uncertain patch',
      );
      expect((await control(request)).patches).toHaveLength(expectedPatches);
    }
    const local = (
      await (await page.request.get(`/api/workouts?${scope}`)).json()
    ).data;
    expect(
      local.plans.find((p: WorkoutPlan) => p.id === plan.id).workouts[0].title,
    ).toBe('After uncertain patch');
  }
  const counters = await control(request);
  expect(counters.posts).toHaveLength(2);
  expect(counters.patches).toHaveLength(2);
  expect(counters.forbiddenWrites).toBe(0);
});

test('imports a phone-created workout read-only without echoing provider writes', async ({
  page,
  request,
}) => {
  await control(request, 'reset');
  const owner = await login(page);
  await connect(page);
  const seeded = await control(request, 'seednative');
  const remoteId = seeded.ids.at(-1)!;
  const scope = `ownerId=${owner}&from=2026-01-01&to=2026-01-01&limit=20`;

  const refreshed = await page.request.post(
    `/api/workouts/transformmate?${scope}`,
    { headers: { origin }, data: {} },
  );
  expect(refreshed.ok()).toBe(true);
  const sync = (await refreshed.json()).data as TransformMateSyncData;
  const native = sync.nativePage.items.find(
    (item) => item.remoteTrainingId === remoteId,
  )!;
  expect(native).toMatchObject({
    source: 'transformmate',
    title: 'Native phone workout',
    progress: 'done',
    date: '2026-01-01',
  });
  expect(native.exercises).toHaveLength(2);
  expect(native.exercises[0]!.metrics.map((metric) => metric.type)).toEqual([
    'plan',
    'fact',
  ]);
  expect(sync.nativeRefresh.status).toBe('fresh');

  const cached = await page.request.get(`/api/workouts/transformmate?${scope}`);
  expect(cached.ok()).toBe(true);
  expect(
    ((await cached.json()).data as TransformMateSyncData).nativePage.items.some(
      (item) => item.remoteTrainingId === remoteId,
    ),
  ).toBe(true);
  await page.goto(`/workouts/native/${remoteId}?date=2026-01-01`);
  await expect(
    page.getByRole('heading', { name: 'Native phone workout', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Внести результаты' }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Изменить план' })).toHaveCount(
    0,
  );
  await page.getByRole('link', { name: 'К тренировкам', exact: true }).click();
  await expect(page).toHaveURL('/workouts?date=2026-01-01');
  const counters = await control(request);
  expect(counters.posts).toHaveLength(0);
  expect(counters.patches).toHaveLength(0);
  expect(counters.forbiddenWrites).toBe(0);
});
test('real cookies protect safe catalog and private synthetic ranged video', async ({
  page,
  browser,
  request,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await control(request, 'reset');
  const owner = await login(page);
  await connect(page);
  const catalog = `/api/workouts/transformmate/exercises?ownerId=${owner}`;
  const video = `/api/workouts/transformmate/exercises/501/video?ownerId=${owner}`;
  expect((await request.get(catalog)).status()).toBe(401);
  const list = await page.request.get(catalog);
  expect(list.ok()).toBe(true);
  expect(await list.json()).toMatchObject({
    data: [{ id: 501, canPlan: true }],
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
  await page
    .getByRole('button', { name: 'Добавить тренировку', exact: true })
    .click();
  const dialog = page;
  const picker = page;
  await picker
    .getByRole('combobox', { name: 'Упражнение', exact: true })
    .fill('Demo');
  await picker
    .getByRole('option', { name: 'Demo exercise', exact: true })
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
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page
    .getByRole('dialog', {
      name: 'Удалить несохранённые изменения?',
      exact: true,
    })
    .getByRole('button', { name: 'Удалить черновик', exact: true })
    .click();
  await expect(player).toHaveCount(0);
  const context = await browser.newContext();
  let grantedTrainerId: string | null = null;
  try {
    const trainer = await context.newPage();
    const trainerId = await login(trainer, 'trainer');
    grantedTrainerId = trainerId;
    grant(owner, trainerId, false);
    expect((await trainer.request.get(video)).status()).toBe(403);
    grant(owner, trainerId, true);
    expect((await trainer.request.head(video)).status()).toBe(200);
    await control(request, 'cachedauthdelay');
    // A cold synthetic detail makes this response wait for the delayed provider.
    const cache = new Database('.data/e2e.sqlite');
    try {
      const cleared = cache
        .prepare(
          'UPDATE transformmate_catalog_exercise SET detail = NULL, detail_fetched_at = NULL WHERE owner_id = ? AND exercise_id = 501',
        )
        .run(owner);
      expect(cleared.changes).toBeGreaterThan(0);
    } finally {
      cache.close();
    }
    const inFlight = trainer.request.get(catalog.replace('?', '/501?'));
    await expect
      .poll(async () => (await control(request)).activeReads)
      .toBeGreaterThan(0);
    grant(owner, trainerId, false);
    expect((await inFlight).status()).toBe(403);
    const deniedCache = new Database('.data/e2e.sqlite');
    try {
      expect(
        deniedCache
          .prepare(
            'SELECT detail, detail_fetched_at FROM transformmate_catalog_exercise WHERE owner_id = ? AND exercise_id = 501',
          )
          .get(owner),
      ).toEqual({ detail: null, detail_fetched_at: null });
    } finally {
      deniedCache.close();
    }
    expect((await trainer.request.get(catalog)).status()).toBe(403);
    expect((await trainer.request.get(video)).status()).toBe(403);
    await request.post('http://127.0.0.1:3158/control', {
      data: { action: 'cachedauthdelay', delay: 0 },
    });
  } finally {
    if (grantedTrainerId) grant(owner, grantedTrainerId, false);
    await request.post('http://127.0.0.1:3158/control', {
      data: { action: 'cachedauthdelay', delay: 0 },
    });
    await context.close();
  }
  expect((await control(request)).forbiddenWrites).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('saving creates once, idle updates once, and remote facts preserve initial and current publication snapshots', async ({
  page,
  request,
}) => {
  await control(request, 'reset');
  const owner = await login(page);
  await connect(page);
  const scope = `ownerId=${owner}&from=2026-01-01&to=2026-01-31&limit=20`;
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
          endsOn: '2026-01-02',
          workouts: data.workouts.map((w) => ({
            ...w,
            title: 'Locally edited workout',
            date: '2026-01-02',
            exercises: w.exercises.map((e) => ({
              ...e,
              comment: 'Updated comment',
              sets: [
                { weightKg: 15, reps: 6 },
                { weightKg: 20, reps: 5 },
              ],
            })),
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
  ).toMatchObject({
    status: 'synced',
    reason: null,
    publishedSnapshot: {
      workout: { title: 'Locally edited workout', date: '2026-01-02' },
    },
  });
  expect((await control(request)).patches).toHaveLength(1);
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
  expect(item.publishedSnapshot!.workout.exercises[0]!.sets[0]).toEqual({
    weightKg: 15,
    reps: 6,
  });
  await page.goto('/workouts');
  await page.getByRole('button', { name: 'Выбрать дату' }).click();
  await page.getByRole('textbox', { name: 'Год', exact: true }).fill('2026');
  await page
    .getByRole('combobox', { name: 'Месяц', exact: true })
    .selectOption('01');
  await page
    .getByRole('combobox', { name: 'День', exact: true })
    .selectOption('02');
  await page.getByRole('button', { name: 'Открыть дату', exact: true }).click();
  await page.keyboard.press('Escape');
  const card = page.getByTestId(`plan-${plan.id}`);
  const table = card.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText([
    'Подход',
    'План',
    'Факт',
  ]);
  await expect(
    table.getByRole('row').nth(1).getByRole('cell').nth(1),
  ).toHaveText('6 × 15 кг');
  await expect(
    table.getByRole('row').nth(1).getByRole('cell').nth(2),
  ).toContainText('12.5');
  await expect(
    table.getByRole('row').nth(1).getByRole('cell').nth(2),
  ).toContainText('7');
  await table.scrollIntoViewIfNeeded();
  const viewport = card.locator('.mantine-ScrollArea-viewport');
  const viewportBounds = await viewport.boundingBox();
  expect(viewportBounds!.x).toBeGreaterThanOrEqual(0);
  expect(viewportBounds!.x + viewportBounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (test.info().project.name === 'mobile') {
    // The current three-column table fits the mobile viewport without horizontal scrolling.
    expect(
      await viewport.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath('synthetic-workout-results.png'),
      fullPage: false,
    });
  }
  await page.screenshot({
    path: test.info().outputPath('synthetic-workout.png'),
    fullPage: false,
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
  await page.goto(`/workouts/links/${item.id}?date=2026-01-02`);
  await expect(page.getByRole('table')).toContainText('6 × 15 кг');
  await expect(
    page.getByRole('button', { name: 'Удалить весь план' }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Изменить план' })).toHaveCount(
    0,
  );
  expect((await control(request)).posts).toHaveLength(1);
  expect((await control(request)).patches).toHaveLength(1);
  expect((await control(request)).forbiddenWrites).toBe(0);
});

test('ambiguous creates never repeat, recovery verifies committed writes and preserves manual records', async ({
  page,
  request,
}) => {
  await control(request, 'reset');
  const owner = await login(page);
  await connect(page);
  const scope = `ownerId=${owner}&from=2026-01-01&to=2026-01-31&limit=20`;
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
