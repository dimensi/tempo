import { signInFixture } from '../ci/real-auth';
import { test, expect, type Page } from '../ci/isolated-test';
import { testOrigin } from '../ci/origin';
import { getSessionWith429Retry } from './auth-session';
import { Input, BufferSource, ALL_FORMATS } from 'mediabunny';
import { workoutMessages as m } from '@/features/workouts/messages';
async function login(page: Page, role: 'owner' | 'trainer' = 'owner') {
  return signInFixture(page, role);
}
async function createSession(page: Page) {
  const ownerId = (await getSessionWith429Retry(page.request)).user.id;
  const exerciseId = crypto.randomUUID();
  const response = await page.request.post(
    `/api/workouts/sessions?ownerId=${ownerId}`,
    {
      headers: { origin: testOrigin },
      data: {
        date: '2026-10-14',
        title: 'Synthetic video acceptance',
        note: '',
        status: 'completed',
        exercises: [
          {
            id: exerciseId,
            name: 'Synthetic squat',
            sets: [{ reps: 10, weightKg: null }],
          },
        ],
      },
    },
  );
  expect(response.ok()).toBe(true);
  const session = (await response.json()).data;
  await page.goto(`/workouts/sessions/${session.id}?date=2026-10-14`);
  await expect(page.getByRole('button', { name: m.videoSelect })).toBeEnabled();
  return { ownerId, sessionId: session.id, exerciseId };
}
test('select, compress rotated MOV, preview, resume network interruption after reload, private owner/trainer playback', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  const { ownerId, sessionId } = await createSession(page);
  await page
    .locator('input[type=file]')
    .setInputFiles('tests/fixtures/workout-videos/rotated.mov');
  await expect(page.getByText(new RegExp(m.videoPreview))).toBeVisible({
    timeout: 45000,
  });
  // A network failure is injected into the first part; server upload metadata survives.
  let interrupted = false;
  await page.route('**/api/workouts/videos/*/parts/*?*', async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.abort('internetdisconnected');
    } else await route.continue();
  });
  await page.getByRole('button', { name: m.videoUpload, exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: m.videoUploadError }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(new RegExp(m.videoPreview))).toBeVisible();
  await page.getByRole('button', { name: m.videoResume, exact: true }).click();
  await expect(
    page.getByRole('button', { name: m.videoDelete, exact: true }),
  ).toBeVisible({ timeout: 45000 });
  const list = await page.request.get(
    `/api/workouts/videos?ownerId=${ownerId}&sessionId=${sessionId}`,
  );
  expect(list.ok()).toBe(true);
  const video = (await list.json()).data.find(
    (item: { state: string }) => item.state === 'ready',
  );
  expect(video).toBeTruthy();
  const url = `/api/workouts/videos/${video.id}/playback?ownerId=${ownerId}`;
  const response = await page.request.get(url);
  expect(response.status()).toBe(200);
  const bytes = await response.body();
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(bytes),
  });
  const track = (await input.getPrimaryVideoTrack())!;
  expect(await track.getCodec()).toBe('avc');
  expect(await track.getDisplayWidth()).toBe(720);
  expect(await track.getDisplayHeight()).toBe(1280);
  expect(await track.getRotation()).toBe(0);
  expect(
    (await track.computePacketStats()).averagePacketRate,
  ).toBeLessThanOrEqual(30.5);
  input.dispose();
  const range = await page.request.get(url, {
    headers: { range: 'bytes=10-99' },
  });
  expect(range.status()).toBe(206);
  expect(await range.body()).toEqual(bytes.subarray(10, 100));
  // Playback through the existing Video.js player, including mobile inline playback.
  const element = page.locator('video').last();
  await element.evaluate((video: HTMLVideoElement) => video.play());
  await expect
    .poll(() =>
      element.evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(0);
  const trainerContext = await browser.newContext({
    baseURL: testOrigin,
    ignoreHTTPSErrors: true,
  });
  const trainer = await trainerContext.newPage();
  await login(trainer, 'trainer');
  const trainerId = (await getSessionWith429Retry(trainer.request)).user.id;
  expect(
    (
      await page.request.post('/api/trainers', {
        headers: { origin: testOrigin },
        data: { ownerId, trainerId },
      })
    ).ok(),
  ).toBe(true);
  await trainer.goto(`/workouts/sessions/${sessionId}?date=2026-10-14`);
  await expect(trainer.locator('video')).toBeVisible();
  await expect(
    trainer.getByRole('button', { name: m.videoSelect }),
  ).toHaveCount(0);
  expect(
    (
      await trainer.request.get(url, { headers: { range: 'bytes=0-9' } })
    ).status(),
  ).toBe(206);
  const anonymous = await browser.newContext({
    baseURL: testOrigin,
    ignoreHTTPSErrors: true,
  });
  expect((await anonymous.request.get(url)).status()).toBe(401);
  await anonymous.close();
  expect(
    (
      await page.request.delete('/api/trainers', {
        headers: { origin: testOrigin },
        data: { ownerId, trainerId },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await trainer.request.get(url, { headers: { range: 'bytes=0-9' } })
    ).status(),
  ).toBe(403);
  await trainerContext.close();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: m.videoDelete, exact: true }).click();
  await expect(
    page.getByRole('button', { name: m.videoDelete, exact: true }),
  ).toHaveCount(0);
});
test('unsupported camera input never sends the original', async ({ page }) => {
  await login(page);
  await createSession(page);
  let uploads = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes('/api/workouts/videos')
    )
      uploads++;
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'unsupported.mov',
    mimeType: 'video/quicktime',
    buffer: Buffer.from('synthetic unsupported codec'),
  });
  await expect(
    page.getByRole('alert').filter({ hasText: m.videoUnsupported }),
  ).toBeVisible();
  expect(uploads).toBe(0);
  await expect(
    page.getByRole('button', { name: m.videoUpload, exact: true }),
  ).toHaveCount(0);
});

test('HEVC MOV either converts using browser support or refuses without uploading original', async ({
  page,
}) => {
  await login(page);
  await createSession(page);
  let uploads = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes('/api/workouts/videos')
    )
      uploads++;
  });
  await page
    .locator('input[type=file]')
    .setInputFiles('tests/fixtures/workout-videos/hevc.mov');
  await expect
    .poll(
      async () =>
        (await page.getByText(new RegExp(m.videoPreview)).count()) +
        (await page
          .getByRole('alert')
          .filter({ hasText: m.videoUnsupported })
          .count()),
      { timeout: 45000 },
    )
    .toBeGreaterThan(0);
  expect(uploads).toBe(0);
  const converted = await page.getByText(new RegExp(m.videoPreview)).count();
  test.info().annotations.push({
    type: 'HEVC',
    description: converted
      ? 'Decoded and transcoded to AVC'
      : 'Decoder unavailable; original refused',
  });
  if (converted) {
    await page
      .getByRole('button', { name: m.videoUpload, exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: m.videoDelete, exact: true }),
    ).toBeVisible({ timeout: 45000 });
  } else
    await expect(
      page.getByRole('button', { name: m.videoUpload, exact: true }),
    ).toHaveCount(0);
});
test('suspending the page pauses the upload and a manual retry resumes it', async ({
  page,
}) => {
  await login(page);
  await createSession(page);
  await page
    .locator('input[type=file]')
    .setInputFiles('tests/fixtures/workout-videos/synthetic.mp4');
  await expect(page.getByText(new RegExp(m.videoPreview))).toBeVisible({
    timeout: 45000,
  });
  let first = true;
  await page.route('**/api/workouts/videos/*/parts/*?*', async (route) => {
    if (!first) {
      await route.continue();
      return;
    }
    first = false;
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await route.abort('aborted').catch(() => {});
  });
  await page.getByRole('button', { name: m.videoUpload, exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: m.videoPaused }),
  ).toBeVisible();
  await page.evaluate(() => {
    delete (document as unknown as Record<string, unknown>).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('button', { name: m.videoResume, exact: true }).click();
  await expect(
    page.getByRole('button', { name: m.videoDelete, exact: true }),
  ).toBeVisible({ timeout: 45000 });
});

test('video creation discovers an expired real session and clears private cache', async ({
  page,
}) => {
  await login(page);
  await createSession(page);
  await page
    .locator('input[type=file]')
    .setInputFiles('tests/fixtures/workout-videos/rotated.mov');
  await expect(page.getByText(new RegExp(m.videoPreview))).toBeVisible({
    timeout: 45000,
  });
  const cachedResources = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('yazio-offline-read-v1', 3);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('resources', 'readonly');
            const count = tx.objectStore('resources').count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error);
            tx.oncomplete = () => db.close();
          };
        }),
    );
  await expect.poll(cachedResources).toBeGreaterThan(0);
  const { seedVideoDraft, storedRows } = await import('./local-storage');
  await seedVideoDraft(page);
  await expect
    .poll(() => storedRows(page, 'tempo-video-upload', 'drafts', 1))
    .toBeGreaterThan(1);
  // Isolate discovery through the video API; server authentication remains real.
  await page.route('**/api/read/context', (route) => route.abort('failed'));
  expect(
    (
      await page.request.post('/api/auth/sign-out', {
        headers: { origin: testOrigin },
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const denied = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/workouts/videos' &&
      response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: m.videoUpload, exact: true }).click();
  const response = await denied;
  expect(response.status()).toBe(401);
  expect(response.headers()['x-auth-error']).toBe('AUTH_REQUIRED');
  expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' });
  await expect(page).toHaveURL('/login');
  expect(await cachedResources()).toBe(0);
  expect(await storedRows(page, 'tempo-video-upload', 'drafts', 1)).toBe(0);
});
