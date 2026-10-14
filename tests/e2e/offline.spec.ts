import { getSignedOutSessionWith429Retry } from './auth-session';
import { test, expect, type Response } from '../ci/isolated-test';
import { build } from 'esbuild';
import { dateInTimezone } from '@/contracts/nutrition-sync-dates';
let harness: string;
test.beforeAll(async () => {
  harness = (
    await build({
      entryPoints: ['tests/offline/browser-harness.ts'],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      tsconfig: 'tsconfig.json',
    })
  ).outputFiles[0]!.text;
});
async function inject(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.addScriptTag({ content: harness });
}
const call = (expression: string) => `window.offlineTest.${expression}`;
test('native IDB preserves blobs, fences stale writes, and retains expired local copies and rejects rollback snapshots', async ({
  page,
}) => {
  await inject(page);
  expect(await page.evaluate(call('seed()'))).toBe(1);
  expect(await page.evaluate(call('read()'))).toEqual({
    present: true,
    photos: 1,
    enabled: true,
  });
  await page.evaluate(call('purge()'));
  expect(await page.evaluate(call('stale()'))).toBe(true);
  expect(await page.evaluate(call('read()'))).toEqual({
    present: false,
    photos: 0,
    enabled: false,
  });
  await page.evaluate(call('seed()'));
  expect(
    await page.evaluate(call('read(window.offlineTest.now + 600000)')),
  ).toEqual({ present: true, photos: 1, enabled: true });
  expect(await page.evaluate(call('read(window.offlineTest.now - 1)'))).toEqual(
    { present: false, photos: 0, enabled: false },
  );
});
test('offline rolling calendar read prunes old records and photo blobs transactionally', async ({
  page,
  context,
}) => {
  // UTC is Oct 13 here, while Europe/Moscow is Oct 14. Keep storage
  // operations in the browser timezone to exercise the real calendar boundary.
  await inject(page);
  await page.evaluate(
    call("seed(undefined, Date.parse('2026-10-13T23:30:00Z'))"),
  );
  expect(await page.evaluate(call('commitOldPhoto()'))).toBe(0);
  expect(await page.evaluate(call('rawCounts()'))).toEqual({
    bundle: 1,
    photos: 0,
  });
  await page.evaluate(
    call("seed(undefined, Date.parse('2026-10-13T23:30:00Z'))"),
  );
  await page.evaluate(call("alterNative('boundary')"));
  await context.setOffline(true);
  try {
    expect(await page.evaluate(call('details()'))).toEqual({
      enabled: true,
      photos: 1,
      collections: [1, 1, 1, 1, 1, 1, 1, 1, 1],
    });
    expect(
      await page.evaluate(call('details(window.offlineTest.now+86400000)')),
    ).toEqual({
      enabled: true,
      photos: 0,
      collections: [0, 0, 0, 0, 0, 1, 1, 1, 1],
    });
    expect(await page.evaluate(call('rawCounts()'))).toEqual({
      bundle: 1,
      photos: 0,
    });
  } finally {
    await context.setOffline(false);
  }
});
test('old unknown-unit cache is physically cleared while device preference survives', async ({
  page,
}) => {
  await inject(page);
  await page.evaluate(call('seed()'));
  await page.evaluate(call("alterNative('old-format')"));
  expect(await page.evaluate(call('read()'))).toEqual({
    present: false,
    photos: 0,
    enabled: true,
  });
  expect(await page.evaluate(call('rawCounts()'))).toEqual({
    bundle: 0,
    photos: 0,
  });
  expect(await page.evaluate(call('stale()'))).toBe(true);
});
test('pre-native cached snapshot and blobs clear while opt-in survives', async ({
  page,
}) => {
  await inject(page);
  await page.evaluate(call('seed()'));
  await page.evaluate(call("alterNative('pre-native')"));
  expect(await page.evaluate(call('read()'))).toEqual({
    present: false,
    photos: 0,
    enabled: true,
  });
  expect(await page.evaluate(call('rawCounts()'))).toEqual({
    bundle: 0,
    photos: 0,
  });
  expect(await page.evaluate(call('stale()'))).toBe(true);
});
test('online controller schema upgrade preserves prior generation opt-in and refills only after identity verification', async ({
  page,
}) => {
  await inject(page);
  await page.evaluate(call('seed()'));
  await page.evaluate(call("alterNative('pre-native')"));
  expect(await page.evaluate(call('rawCounts()'))).toEqual({
    bundle: 1,
    photos: 1,
  });
  const result = await page.evaluate<{ requests: string[] }>(
    call('upgradeOnline()'),
  );
  expect(result).toMatchObject({
    enabled: true,
    status: 'ready',
    native: 1,
    photos: 0,
    generationAdvanced: true,
    nativePublishes: [1],
  });
  expect(result.requests).toEqual([
    '/api/offline/identity',
    expect.stringMatching(/^\/api\/offline\/snapshot\?from=/),
    '/api/offline/identity',
  ]);
  expect(await page.evaluate(call('rawCounts()'))).toEqual({
    bundle: 1,
    photos: 0,
  });
  expect(await page.evaluate(call('stale()'))).toBe(true);
});
test('two tabs hide private DOM and enlarged offline photo synchronously before physical cleanup', async ({
  page,
  context,
}) => {
  await inject(page);
  await page.evaluate(call('seed()'));
  await page.evaluate(call('prepareShell()'));
  const second = await context.newPage();
  await inject(second);
  await second.evaluate(() => {
    const element = document.createElement('div');
    element.dataset.offlinePrivate = '';
    element.textContent = 'Synthetic private';
    document.body.append(element);
  });
  await second.evaluate(call('listen()'));
  await context.setOffline(true);
  try {
    const date = dateInTimezone(
      new Date(await page.evaluate(call('now'))),
      await page.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    );
    await page.goto(`/diary?date=${date}`);
    await page.getByRole('button', { name: /^Увеличить фото:/ }).click();
    const portal = page
      .getByRole('dialog', { name: 'Фото приёма пищи' })
      .locator('[data-offline-private]');
    await expect(portal.locator('img[src^="blob:"]')).toBeVisible();
    await page.addScriptTag({ content: harness });
    expect(
      await page.evaluate(async () => {
        const privateImage = document.querySelector<HTMLElement>(
          '[role="dialog"] [data-offline-private]',
        );
        const pending = Reflect.get(window, 'offlineTest').purge();
        const immediatelyHidden = privateImage?.hidden === true;
        await pending;
        return immediatelyHidden;
      }),
    ).toBe(true);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
    await expect(second.locator('[data-offline-private]')).toBeHidden();
    expect(await second.evaluate(call('read(Date.now())'))).toEqual({
      present: false,
      photos: 0,
      enabled: false,
    });
  } finally {
    await context.setOffline(false);
  }
});

test('physical storage failure never prevents sign-in or sign-out and leaves durable blocker', async ({
  page,
}) => {
  await page.goto('/login');
  await page.evaluate(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('Synthetic storage failure', 'InvalidStateError');
    };
  });
  await page.locator('input[type=email]').fill('owner@example.test');
  await page.locator('input[type=password]').fill('Test-only-password-12345');
  const submitted = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const result = await submitted;
  if (result.status() === 429) {
    const seconds = Number(
      result.headers()['x-retry-after'] ??
        result.headers()['retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
  }
  await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('yazio.offline.block.v1')!).disabled,
    ),
  ).toBe(true);
  if (
    await page
      .getByRole('button', { name: 'Навигация', exact: true })
      .isVisible()
  )
    await page.getByRole('button', { name: 'Навигация', exact: true }).click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('yazio.offline.block.v1')!).disabled,
    ),
  ).toBe(true);
  expect(await getSignedOutSessionWith429Retry(page.request)).toBeNull();
});
test('pending provider intent blocks sibling re-enable and final completion preserves physical purge', async ({
  page,
  context,
}) => {
  await inject(page);
  const sibling = await context.newPage();
  await inject(sibling);
  await sibling.evaluate(call('listen()'));
  await sibling.evaluate(call('seed()'));
  await page.evaluate(call('startMutation()'));
  await expect.poll(() => page.evaluate(call('enteredMutation()'))).toBe(true);
  await expect(sibling.evaluate(call('seed()'))).rejects.toThrow(
    'Offline storage fence',
  );
  expect(await sibling.evaluate(call('read(Date.now())'))).toEqual({
    present: false,
    photos: 0,
    enabled: false,
  });
  await sibling.evaluate(() => {
    const node = document.createElement('div');
    node.dataset.offlinePrivate = '';
    node.textContent = 'Synthetic provider data';
    document.body.append(node);
  });
  expect(await page.evaluate(call('finishMutation()'))).toBe(
    'provider-success',
  );
  await expect(sibling.locator('[data-offline-private]')).toBeHidden();
  expect(await sibling.evaluate(call('read()'))).toEqual({
    present: false,
    photos: 0,
    enabled: false,
  });
  expect(await sibling.evaluate(call('stale()'))).toBe(true);
});

test('shorter live server expiry does not expire an already downloaded local copy', async ({
  page,
}) => {
  await inject(page);
  await page.evaluate(call('seed()'));
  const baseline = Number(await page.evaluate(call('now')));
  // Genuine downloaded server metadata is preserved; no extended server authorization.
  expect(await page.evaluate(call('shortenExpiry()'))).toBe(baseline + 600000);
  expect(
    await page.evaluate(call('read(window.offlineTest.now+1200001)')),
  ).toEqual({ present: true, photos: 1, enabled: true });
});
test.describe('provider form interception', () => {
  // Page routing cannot intercept API fetches issued by an active service worker.
  // These cases exercise the real form, auth and Web Locks with a held synthetic POST.
  test.use({ serviceWorkers: 'block' });
  for (const unmount of [false, true]) {
    test(`actual provider form completion purges sibling cache during delayed POST${unmount ? ' after unmount' : ''}`, async ({
      page,
      context,
    }) => {
      const signIn = () =>
        page.request.post('/api/auth/sign-in/email', {
          headers: {
            origin: String(test.info().project.use.baseURL),
          },
          data: {
            email: 'owner@example.test',
            password: 'Test-only-password-12345',
          },
        });
      let auth = await signIn();
      if (auth.status() === 429) {
        const seconds = Number(
          auth.headers()['x-retry-after'] ??
            auth.headers()['retry-after'] ??
            10,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, (seconds + 1) * 1000),
        );
        auth = await signIn();
      }
      expect(auth.status()).toBe(200);
      const loaded = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/transformmate/status') &&
          response.status() === 200,
      );
      await page.goto('/settings#transformmate');
      await loaded;
      await expect(
        page
          .locator('#transformmate')
          .getByRole('button', { name: 'Подключить', exact: true }),
      ).toBeEnabled();
      let release!: () => void;
      let entered!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      await page.route('**/api/transformmate/connect', async (route) => {
        entered();
        await pending;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              configured: false,
              account: null,
              checkedAt: null,
              errorCode: null,
            },
          }),
        });
      });
      // Observe from submission, but start the bounded wait only after releasing the held POST.
      let completed: Response | undefined;
      const observeCompletion = (response: Response) => {
        if (response.url().endsWith('/api/transformmate/connect'))
          completed = response;
      };
      page.on('response', observeCompletion);
      const form = page.locator('#transformmate');
      await form
        .getByLabel(/^Firebase API key/)
        .filter({ visible: true })
        .fill('synthetic-key');
      await form
        .getByLabel(/^Firebase refresh token/)
        .filter({ visible: true })
        .fill('synthetic-refresh');
      await form
        .getByRole('button', { name: 'Подключить', exact: true })
        .click();
      await started;
      if (unmount) {
        const navigation = page.getByRole('button', {
          name: 'Навигация',
          exact: true,
        });
        if (await navigation.isVisible()) {
          await navigation.click();
          await expect(navigation).toHaveAttribute('aria-expanded', 'true');
        }
        await page.getByRole('link', { name: 'Обзор', exact: true }).click();
        await expect(form).toHaveCount(0);
      }
      const sibling = await context.newPage();
      await inject(sibling);
      await sibling.evaluate(call('listen()'));
      await expect(sibling.evaluate(call('seed()'))).rejects.toThrow(
        'Offline storage fence',
      );
      expect(await sibling.evaluate(call('read(Date.now())'))).toEqual({
        present: false,
        photos: 0,
        enabled: false,
      });
      release();
      await expect
        .poll(() => completed?.status(), { timeout: 15000 })
        .toBe(200);
      page.off('response', observeCompletion);
      if (!unmount)
        await expect(
          form.getByText('Подключение сохранено.', { exact: true }),
        ).toBeVisible();
      await expect
        .poll(() => sibling.evaluate(call('read()')))
        .toEqual({ present: false, photos: 0, enabled: false });
      expect(await sibling.evaluate(call('read()'))).toEqual({
        present: false,
        photos: 0,
        enabled: false,
      });
    });
  }
});
