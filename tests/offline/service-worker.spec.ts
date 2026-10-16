import { test, expect, type Page } from '../ci/isolated-test';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
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
test.beforeEach(async ({ request }) => {
  expect(
    (
      await request.post('/__offline-test/control', {
        data: {
          mode: 'current',
          hold: false,
          navigationStatus: 0,
          stalledNavigation: false,
          stalledIdentity: false,
          stalledApi: false,
        },
      })
    ).ok(),
  ).toBe(true);
});
test.afterEach(async ({ request }) => {
  await request.post('/__offline-test/control', {
    data: {
      mode: 'current',
      hold: false,
      navigationStatus: 0,
      stalledNavigation: false,
      stalledIdentity: false,
      stalledApi: false,
    },
  });
});
test('closed browser restarts from its persisted shell while navigation and identity never respond', async ({
  playwright,
  browserName,
  request,
}, info) => {
  const profile = info.outputPath('persistent-profile');
  const options = {
    baseURL: String(info.project.use.baseURL),
    ignoreHTTPSErrors: true,
    serviceWorkers: 'allow' as const,
    args: browserName === 'chromium' ? ['--ignore-certificate-errors'] : [],
  };
  let context = await playwright[browserName].launchPersistentContext(
    profile,
    options,
  );
  try {
    let page = context.pages()[0]!;
    await page.goto('/login');
    await page.addScriptTag({ content: harness });
    await page.evaluate('window.offlineTest.seed("sections")');
    await page.evaluate('window.offlineTest.prepareShell()');
    await context.close();
    await request.post('/__offline-test/control', {
      data: {
        stalledNavigation: true,
        stalledIdentity: true,
        stalledApi: true,
      },
    });
    context = await playwright[browserName].launchPersistentContext(
      profile,
      options,
    );
    page = context.pages()[0]!;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const started = Date.now();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 7000 });
    await expect(
      page.getByRole('heading', { name: 'Обзор', exact: true }),
    ).toBeVisible({ timeout: 6000 });
    expect(Date.now() - started).toBeLessThan(8000);
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Сеть или сервер недоступны' }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
async function seed(page: Page) {
  await page.goto('/login');
  await page.addScriptTag({ content: harness });
  await page.evaluate('window.offlineTest.seed()');
}
async function prepareLegacy(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/offline-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  });
}
async function cachePaths(page: Page) {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        paths.push(new URL(request.url).pathname);
    return paths.sort();
  });
}
test('production precache and standalone contain only the public application shell', async ({
  page,
}) => {
  const worker = readFileSync('public/offline-sw.js', 'utf8');
  expect(readFileSync('.next/standalone/public/offline-sw.js', 'utf8')).toBe(
    worker,
  );
  for (const file of [
    'index.html',
    ...readdirSync('public/offline/assets').map((name) => `assets/${name}`),
  ])
    expect(readFileSync(`.next/standalone/public/offline/${file}`)).toEqual(
      readFileSync(`public/offline/${file}`),
    );
  await seed(page);
  await page.evaluate('window.offlineTest.prepareShell()');
  const paths = await cachePaths(page);
  expect(paths.sort()).toEqual(
    [
      '/offline/index.html',
      ...readdirSync('public/offline/assets').map(
        (name) => `/offline/assets/${name}`,
      ),
    ].sort(),
  );
  await page.evaluate(() =>
    navigator.serviceWorker.controller?.postMessage({
      type: 'CACHE_URLS',
      payload: {
        urlsToCache: ['/api/offline/snapshot', '/settings', '/login'],
      },
    }),
  );
  await expect.poll(() => cachePaths(page)).toEqual(paths);
});
test('fresh pages cold-launch the application shell only for supported navigations', async ({
  page,
  context,
}) => {
  await seed(page);
  await page.evaluate('window.offlineTest.prepareShell()');
  await context.setOffline(true);
  try {
    for (const path of [
      '/',
      '/diary',
      '/analytics',
      '/measurements',
      '/workouts',
      '/settings',
      '/reports',
      '/workouts/native/101',
      '/workouts/sessions/synthetic-session',
      '/offline/index.html',
    ]) {
      const cold = await context.newPage();
      await cold.goto(path);
      await expect(
        cold.locator('[data-offline-private]').first(),
      ).toBeVisible();

      await cold.close();
    }
    for (const path of ['/login', '/unknown', '/workouts/arbitrary/path']) {
      const cold = await context.newPage();
      await expect(cold.goto(path)).rejects.toThrow();
      await cold.close();
    }
    await expect(
      page.evaluate(() =>
        fetch('/api/offline/identity').then((response) => response.text()),
      ),
    ).rejects.toThrow();
    await expect(
      page.evaluate(() =>
        fetch('/diary?_rsc=synthetic', { headers: { RSC: '1' } }).then(
          (response) => response.text(),
        ),
      ),
    ).rejects.toThrow();
  } finally {
    await context.setOffline(false);
  }
});
test('online access denial never returns the reader and purges private storage', async ({
  page,
}) => {
  await seed(page);
  await page.evaluate('window.offlineTest.prepareShell()');
  await page.reload();
  await page.addScriptTag({ content: harness });
  const denied = await page.evaluate(async () => {
    const response = await fetch('/api/offline/identity');
    return { status: response.status, body: await response.text() };
  });
  expect(denied.status).toBe(401);
  expect(denied.body).not.toContain('offline-root');
  await expect
    .poll(() => page.evaluate('window.offlineTest.rawCounts()'))
    .toEqual({ bundle: 0, photos: 0 });
  const response = await page.goto('/diary');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL('/login');
  expect(await cachePaths(page)).not.toContain('/login');
});
test('HTTP navigation errors remain network responses rather than reader fallback', async ({
  page,
  request,
}) => {
  await seed(page);
  await page.evaluate('window.offlineTest.prepareShell()');
  for (const status of [401, 403, 500]) {
    await request.post('/__offline-test/control', {
      data: { navigationStatus: status },
    });
    const response = await page.goto('/diary');
    expect(response?.status()).toBe(status);
    await expect(page.locator('#offline-root')).toHaveCount(0);
    await expect(page.getByText('Synthetic network HTTP error')).toBeVisible();
  }
  expect(await cachePaths(page)).not.toContain('/diary');
});
test('same-endpoint update retains IDB and replaces old static cache after installation', async ({
  page,
  request,
}) => {
  await request.post('/__offline-test/control', { data: { mode: 'legacy' } });
  await seed(page);
  await prepareLegacy(page);
  await page.reload();
  await page.addScriptTag({ content: harness });
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .toContain('yazio-offline-shell-legacy-test');
  await request.post('/__offline-test/control', {
    data: { mode: 'current', hold: true },
  });
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration!.update();
  });
  await expect
    .poll(
      async () =>
        (await (await request.get('/__offline-test/activity')).json()).held,
    )
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => caches.keys())).toContain(
    'yazio-offline-shell-legacy-test',
  );
  expect(await page.evaluate('window.offlineTest.read()')).toMatchObject({
    present: true,
    enabled: true,
    photos: 1,
  });
  expect(
    await page.evaluate(`Promise.race([
    window.offlineTest.prepareShell().then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 250)),
  ])`),
  ).toBe(false);
  await request.post('/__offline-test/control', { data: { hold: false } });
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
      ),
    )
    .toBe(true);
  expect(await page.evaluate(() => caches.keys())).toContain(
    'yazio-offline-shell-legacy-test',
  );
  expect(await page.evaluate('window.offlineTest.read()')).toMatchObject({
    present: true,
    enabled: true,
    photos: 1,
  });
  const context = page.context();
  await page.close();
  const fresh = await context.newPage();
  await fresh.goto('/login');
  await expect
    .poll(() =>
      fresh.evaluate(async () =>
        Boolean((await navigator.serviceWorker.getRegistration())?.active),
      ),
    )
    .toBe(true);
  await expect
    .poll(() => fresh.evaluate(() => caches.keys()))
    .not.toContain('yazio-offline-shell-legacy-test');
  await fresh.addScriptTag({ content: harness });
  expect(await fresh.evaluate('window.offlineTest.read()')).toMatchObject({
    present: true,
    enabled: true,
    photos: 1,
  });
  await context.setOffline(true);
  await fresh.goto('/workouts');
  await expect(
    fresh.getByRole('heading', {
      name: 'Synthetic native history',
      exact: true,
    }),
  ).toBeVisible();
  await context.setOffline(false);
});
test('failed worker update leaves the old active worker and stored data usable', async ({
  page,
  request,
}) => {
  await request.post('/__offline-test/control', { data: { mode: 'legacy' } });
  await seed(page);
  await prepareLegacy(page);
  await request.post('/__offline-test/control', { data: { mode: 'broken' } });
  expect(
    await page.evaluate(async () => {
      try {
        await (await navigator.serviceWorker.getRegistration())!.update();
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  expect(await page.evaluate(() => caches.keys())).toContain(
    'yazio-offline-shell-legacy-test',
  );
  expect(await page.evaluate('window.offlineTest.read()')).toMatchObject({
    present: true,
    enabled: true,
    photos: 1,
  });
  await page.context().setOffline(true);
  await page.goto('/diary');
  await expect(
    page.getByText('Synthetic breakfast', { exact: true }),
  ).toBeVisible();
  await page.context().setOffline(false);
});
