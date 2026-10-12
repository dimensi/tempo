import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
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
test('native IDB preserves blobs, fences stale writes, and removes expired or rollback snapshots', async ({
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
  ).toEqual({ present: false, photos: 0, enabled: false });
  await page.evaluate(call('seed()'));
  expect(await page.evaluate(call('read(window.offlineTest.now - 1)'))).toEqual(
    { present: false, photos: 0, enabled: false },
  );
});
test('two tabs hide private DOM and durably block storage before physical cleanup', async ({
  page,
  context,
}) => {
  await inject(page);
  await page.evaluate(call('seed()'));
  const second = await context.newPage();
  await inject(second);
  await second.evaluate(() => {
    const element = document.createElement('div');
    element.dataset.offlinePrivate = '';
    element.textContent = 'Synthetic private';
    document.body.append(element);
  });
  await second.evaluate(call('listen()'));
  await page.evaluate(call('purge()'));
  await expect(second.locator('[data-offline-private]')).toBeHidden();
  expect(await second.evaluate(call('read()'))).toEqual({
    present: false,
    photos: 0,
    enabled: false,
  });
});

test('OWNER explicitly saves real API snapshot, offline read preserves zero and unknown unit; TRAINER is denied', async ({
  page,
}, info) => {
  const db = new Database('.data/e2e.sqlite');
  const owner = db
    .prepare("SELECT id FROM user WHERE email = 'owner@example.test'")
    .get() as { id: string };
  const date = new Date().toISOString().slice(0, 10);
  const observed = new Date().toISOString();
  db.prepare(
    'INSERT OR REPLACE INTO yazio_daily_steps(owner_id,date,steps,observed_at) VALUES(?,?,?,?)',
  ).run(owner.id, date, 0, observed);
  db.prepare(
    'INSERT OR REPLACE INTO yazio_weight_entries(owner_id,external_id,provider_date,measured_date,raw_value,unit,unit_context,observed_at) VALUES(?,?,?,?,?,NULL,?,?)',
  ).run(
    owner.id,
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    date,
    date,
    null,
    'lb',
    observed,
  );
  const signIn = async (role: string) => {
    const request = () =>
      page.request.post('/api/auth/sign-in/email', {
        headers: {
          origin: `http://localhost:${process.env.E2E_PORT ?? '3100'}`,
        },
        data: {
          email: `${role}@example.test`,
          password: 'Test-only-password-12345',
        },
      });
    let response = await request();
    if (response.status() === 429) {
      const seconds = Number(
        response.headers()['x-retry-after'] ??
          response.headers()['retry-after'] ??
          10,
      );
      await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
      response = await request();
    }
    expect(response.status()).toBe(200);
  };
  try {
    await signIn('owner');
    await page.goto('/settings#offline');
    const section = page.locator('#offline');
    await expect(section).toContainText(
      'По умолчанию данные на устройстве не сохраняются',
    );
    expect(
      await section
        .locator('input[type=date]')
        .evaluateAll((inputs) =>
          inputs.every(
            (input) =>
              input.getBoundingClientRect().height >= 44 &&
              parseFloat(getComputedStyle(input).fontSize) >= 16,
          ),
        ),
    ).toBe(true);
    await section.locator('input[type=date]').nth(0).fill(date);
    await section.locator('input[type=date]').nth(1).fill(date);
    await section
      .getByRole('button', { name: 'Включить и сохранить период', exact: true })
      .click();
    await expect(
      section.getByRole('link', { name: 'Открыть сохранённые данные' }),
    ).toBeVisible({ timeout: 30000 });
    expect(
      (await section
        .getByRole('link', { name: 'Открыть сохранённые данные' })
        .boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    await page.goto('/offline/index.html');
    await expect(
      page.getByRole('heading', { name: 'Offline-чтение', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('tab', { name: 'Локальные замеры', exact: true })
      .click();
    await expect(
      page.getByText('Единица неизвестна', { exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    await expect(
      page.getByText('Пропуски не считаются нулевыми.', { exact: false }),
    ).toBeVisible();
    await expect(page.locator('[data-offline-private]')).toBeVisible();
    await page.context().setOffline(true);
    await page.reload();
    await expect(
      page.getByText('Без сети · сохранённые данные', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('synthetic-offline.png'),
      fullPage: true,
    });
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    expect(
      await page
        .locator('td')
        .evaluateAll((cells) =>
          cells.every(
            (cell) => parseFloat(getComputedStyle(cell).fontSize) >= 16,
          ),
        ),
    ).toBe(true);
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pagehide', { persisted: true }),
      ),
    );
    await expect(page.locator('[data-offline-private]')).toHaveCount(0);
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      ),
    );
    await expect(page.locator('[data-offline-private]')).toBeVisible();
    const cache = await page.evaluate(async () => {
      const result: string[] = [];
      for (const name of await caches.keys())
        for (const req of await (await caches.open(name)).keys())
          result.push(new URL(req.url).pathname);
      return result;
    });
    expect(cache.length).toBeGreaterThan(0);
    expect(
      cache.every(
        (path) =>
          path.startsWith('/offline/assets/') ||
          /^\/offline\/shell-.*\.html$/.test(path),
      ),
    ).toBe(true);
    await page.context().setOffline(false);
    await signIn('trainer');
    await page.reload();
    await expect(page.locator('[data-offline-private]')).toHaveCount(0);
    expect((await page.request.get('/api/offline/identity')).status()).toBe(
      403,
    );
    await page.goto('/settings');
    await expect(page.locator('#offline')).toHaveCount(0);
  } finally {
    await page.context().setOffline(false);
    db.prepare('DELETE FROM yazio_daily_steps WHERE owner_id=? AND date=?').run(
      owner.id,
      date,
    );
    db.prepare(
      'DELETE FROM yazio_weight_entries WHERE owner_id=? AND external_id=?',
    ).run(owner.id, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    db.close();
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
  expect(
    await (await page.request.get('/api/auth/get-session')).json(),
  ).toBeNull();
});
test('offline read-only view renders all synthetic stored sections without mutation controls', async ({
  page,
  context,
}, info) => {
  await inject(page);
  await page.evaluate(call('prepareShell()'));
  await page.evaluate(call('seed()'));
  await context.setOffline(true);
  try {
    await page.goto('/offline/index.html');
    await expect(
      page.getByText('Без сети · сохранённые данные', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: new RegExp(new Date().toISOString().slice(0, 10)),
      })
      .click();
    await expect(
      page.getByText('Synthetic breakfast', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('tab', { name: 'Локальные замеры', exact: true })
      .click();
    await expect(
      page.getByText('Synthetic manual', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Единица неизвестна', { exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Фотографии', exact: true }).click();
    const photo = page.locator('img[src^="blob:"]');
    await expect(photo).toHaveAttribute('src', /^blob:/);
    await expect
      .poll(() =>
        photo.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    await page.getByRole('tab', { name: 'Тренировки', exact: true }).click();
    await expect(
      page.getByText('Synthetic actual', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText('Synthetic cached fact', { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('synthetic-offline-workouts.png'),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Сохранить|Изменить|Добавить/ }),
    ).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});

test('delayed provider completion clears a sibling tab re-enabled during the pending mutation', async ({
  page,
  context,
}) => {
  await inject(page);
  const sibling = await context.newPage();
  await inject(sibling);
  await sibling.evaluate(call('listen()'));
  await page.evaluate(call('startMutation()'));
  await expect.poll(() => page.evaluate(call('enteredMutation()'))).toBe(true);
  await sibling.evaluate(call('seed()'));
  expect(await sibling.evaluate(call('read()'))).toMatchObject({
    present: true,
    photos: 1,
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

test('same-generation fresh expiry is persisted in native IDB before offline reopen', async ({
  page,
}) => {
  await inject(page);
  await page.evaluate(call('seed()'));
  const baseline = Number(await page.evaluate(call('now')));
  expect(await page.evaluate(call('shortenExpiry()'))).toBe(baseline + 1000);
  expect(
    await page.evaluate(call('read(window.offlineTest.now+999)')),
  ).toMatchObject({ present: true, photos: 1 });
  expect(
    await page.evaluate(call('read(window.offlineTest.now+1000)')),
  ).toEqual({ present: false, photos: 0, enabled: false });
});
test('actual provider form completion purges the cache saved by a sibling during delayed POST', async ({
  page,
  context,
}) => {
  const signIn = () =>
    page.request.post('/api/auth/sign-in/email', {
      headers: { origin: `http://localhost:${process.env.E2E_PORT ?? '3100'}` },
      data: {
        email: 'owner@example.test',
        password: 'Test-only-password-12345',
      },
    });
  let auth = await signIn();
  if (auth.status() === 429) {
    const seconds = Number(
      auth.headers()['x-retry-after'] ?? auth.headers()['retry-after'] ?? 10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    auth = await signIn();
  }
  expect(auth.status()).toBe(200);
  await page.goto('/settings#transformmate');
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
  const form = page.locator('#transformmate');
  await form.getByLabel(/^Firebase API key/).fill('synthetic-key');
  await form.getByLabel(/^Firebase refresh token/).fill('synthetic-refresh');
  await form.getByRole('button', { name: 'Подключить', exact: true }).click();
  await started;
  const sibling = await context.newPage();
  await inject(sibling);
  await sibling.evaluate(call('listen()'));
  await sibling.evaluate(call('seed()'));
  expect(await sibling.evaluate(call('read()'))).toMatchObject({
    present: true,
    photos: 1,
  });
  release();
  await expect(
    form.getByText('Подключение сохранено.', { exact: true }),
  ).toBeVisible();
  expect(await sibling.evaluate(call('read()'))).toEqual({
    present: false,
    photos: 0,
    enabled: false,
  });
  expect(await sibling.evaluate(call('stale()'))).toBe(true);
});
