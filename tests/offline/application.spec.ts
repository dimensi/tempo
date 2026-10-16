import Database from 'better-sqlite3';
import { expect, test, type Page } from '../ci/isolated-test';
import { syntheticDay } from '../unit/reports/fixtures';
import { seedVideoDraft, storedRows } from '../e2e/local-storage';
test.use({ timezoneId: 'UTC' });
async function signIn(page: Page, role = 'owner') {
  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: String(test.info().project.use.baseURL) },
    data: {
      email: `${role}@example.test`,
      password: 'Test-only-password-12345',
    },
  });
  expect(response.status()).toBe(200);
}
async function menu(page: Page) {
  const button = page.getByRole('button', { name: 'Навигация', exact: true });
  if (await button.isVisible()) {
    if ((await button.getAttribute('aria-expanded')) !== 'true')
      await button.click();
  }
}
function seed() {
  const db = new Database('.data/e2e.sqlite');
  const owner = db
    .prepare('SELECT id FROM user WHERE email = ?')
    .get('owner@example.test') as { id: string };
  const date = new Date().toISOString().slice(0, 10);
  const day = syntheticDay(date);
  db.prepare(
    'INSERT OR REPLACE INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES(?,?,?,?)',
  ).run(owner.id, date, JSON.stringify(day), new Date().toISOString());
  db.prepare(
    'INSERT OR REPLACE INTO measurements(id,owner_id,measured_at,values_json,note) VALUES(?,?,?,?,?)',
  ).run(
    'cached-measurement',
    owner.id,
    date,
    JSON.stringify([{ metric: 'weight', value: '72', unit: 'kg' }]),
    'Synthetic cached observation',
  );
  const trainer = db
    .prepare('SELECT id FROM user WHERE email = ?')
    .get('trainer@example.test') as { id: string };
  db.prepare(
    'INSERT OR REPLACE INTO trainer_access(owner_id,trainer_id,created_at) VALUES(?,?,?)',
  ).run(owner.id, trainer.id, Date.now());
  db.close();
  return date;
}
async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('yazio-offline-read-v1', 3);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('resources', 'readonly');
          const rows = tx.objectStore('resources').count();
          rows.onsuccess = () => resolve(rows.result);
          tx.oncomplete = () => db.close();
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

test('cached measurements render before stalled API reads finish', async ({
  page,
}) => {
  seed();
  await signIn(page);
  await page.goto('/measurements');
  await expect(
    page.getByText('Synthetic cached observation').first(),
  ).toBeVisible();
  await expect.poll(() => stored(page)).toBeGreaterThan(0);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/api\/(?:measurements(?:\?|$)|health\/weight)/,
    async (route) => {
      await held;
      await route.continue().catch(() => {});
    },
  );
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Заметка', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Synthetic cached observation').first(),
    ).toBeVisible();
  } finally {
    release();
  }
});
test('connection changes and background refresh preserve the current form node and draft', async ({
  page,
  context,
}) => {
  seed();
  await signIn(page);
  await page.goto('/measurements');
  const note = page.getByLabel('Заметка', { exact: true });
  await note.fill('Unsent resilience draft');
  await page.evaluate(() =>
    Reflect.set(
      window,
      'originalDraftNode',
      document.querySelector('textarea'),
    ),
  );
  await context.setOffline(true);
  await expect(note).toHaveValue('Unsent resilience draft');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(note).toHaveValue('Unsent resilience draft');
  expect(
    await page.evaluate(
      () =>
        Reflect.get(window, 'originalDraftNode') ===
        document.querySelector('textarea'),
    ),
  ).toBe(true);
});
test('ordinary Next navigation and Back restore a measurement draft', async ({
  page,
}) => {
  seed();
  await signIn(page);
  await page.goto('/measurements');
  await page.getByLabel('Заметка', { exact: true }).fill('Draft across routes');
  await menu(page);
  await page.getByRole('link', { name: 'Обзор', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goBack();
  await expect(page).toHaveURL('/measurements');
  await expect(page.getByLabel('Заметка', { exact: true })).toHaveValue(
    'Draft across routes',
  );
  await page.goForward();
  await expect(page).toHaveURL('/');
});
test('server failure preserves last known data without offline banners or document navigation', async ({
  page,
}) => {
  seed();
  await signIn(page);
  await page.goto('/measurements');
  await expect(
    page.getByText('Synthetic cached observation').first(),
  ).toBeVisible();
  await page.route('**/api/measurements?*', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(
    page.getByText('Synthetic cached observation').first(),
  ).toBeVisible();
  await expect(page).toHaveURL('/measurements');
  expect(await page.locator('[data-read-workspace]').count()).toBe(0);
});
test('trainer cached data remains available until reconnect discovers revoked grant', async ({
  page,
  context,
}) => {
  seed();
  await signIn(page, 'trainer');
  await page.goto('/measurements');
  await expect(
    page.getByText('Synthetic cached observation').first(),
  ).toBeVisible();
  await expect.poll(() => stored(page)).toBeGreaterThan(0);
  await seedVideoDraft(page);
  await context.setOffline(true);
  const db = new Database('.data/e2e.sqlite');
  db.prepare('DELETE FROM trainer_access').run();
  db.close();
  await expect(
    page.getByText('Synthetic cached observation').first(),
  ).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page).toHaveURL('/login');
  await expect.poll(() => stored(page)).toBe(0);
  expect(await storedRows(page, 'tempo-video-upload', 'drafts', 1)).toBe(0);
  const response = await page.request.get('/api/measurements?ownerId=unknown');
  expect(response.status()).toBe(401);
});
test('an action-level forbidden check does not clear cached data or log out', async ({
  page,
}) => {
  seed();
  await signIn(page);
  await page.goto('/measurements');
  await expect(
    page.getByText('Synthetic cached observation').first(),
  ).toBeVisible();
  await page.route('**/api/read/context', (route) =>
    route.fulfill({ status: 403, json: { error: 'FORBIDDEN' } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByText('Synthetic cached observation').first(),
  ).toBeVisible();
  await expect(page).toHaveURL('/measurements');
  expect((await page.request.get('/api/auth/get-session')).status()).toBe(200);
});
test('offline logout clears read cache and durable intent blocks old-session restoration', async ({
  page,
  context,
}) => {
  seed();
  await signIn(page);
  await page.goto('/measurements');
  await expect.poll(() => stored(page)).toBeGreaterThan(0);
  await seedVideoDraft(page);
  await context.setOffline(true);
  await menu(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByLabel('Электронная почта')).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('tempo:logout-pending')),
  ).toBe('true');
  await expect.poll(() => stored(page)).toBe(0);
  expect(await storedRows(page, 'tempo-video-upload', 'drafts', 1)).toBe(0);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  // Reconnect completes sign-out and redirects itself; a second navigation races it.
  await expect(page).toHaveURL('/login');
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('tempo:logout-pending')),
    )
    .toBeNull();
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL('/');
  expect(
    await page.evaluate(() => localStorage.getItem('tempo:logout-pending')),
  ).toBeNull();
});
test('local measurement commits survive reopening and synchronize only once', async ({
  page,
  context,
}) => {
  seed();
  await signIn(page);
  await page.goto('/measurements');
  await expect(page.getByLabel('Заметка', { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const response = await page.request.get('/api/offline/writes');
      return response.status();
    })
    .toBe(200);
  await context.setOffline(true);
  await page
    .getByLabel('Заметка', { exact: true })
    .fill('Queued durable measurement');
  await page.getByLabel('Вес (кг)', { exact: true }).fill('73');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    page.getByText('Сохранено на устройстве', { exact: true }).first(),
  ).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect
    .poll(async () => {
      const db = new Database('.data/e2e.sqlite');
      try {
        return (
          db
            .prepare('SELECT count(*) as n FROM measurements WHERE note = ?')
            .get('Queued durable measurement') as { n: number }
        ).n;
      } finally {
        db.close();
      }
    })
    .toBe(1);
  const sibling = await context.newPage();
  await sibling.goto('/measurements');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await sibling.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(
    page.getByText('Queued durable measurement').first(),
  ).toBeVisible();
  const db = new Database('.data/e2e.sqlite');
  expect(
    (
      db
        .prepare('SELECT count(*) as n FROM measurements WHERE note = ?')
        .get('Queued durable measurement') as { n: number }
    ).n,
  ).toBe(1);
  db.close();
});

test('account replacement clears the previous reader and notifies the other tab', async ({
  page,
  context,
}) => {
  seed();
  await signIn(page);
  await page.goto('/measurements');
  await expect(
    page.getByText('Synthetic cached observation').first(),
  ).toBeVisible();
  const sibling = await context.newPage();
  await sibling.goto('/measurements');
  await expect(
    sibling.getByText('Synthetic cached observation').first(),
  ).toBeVisible();
  await seedVideoDraft(page);
  await signIn(page, 'trainer');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL('/login');
  await expect(sibling.getByLabel('Электронная почта')).toBeVisible();
  await expect(sibling.getByText('Synthetic cached observation')).toHaveCount(
    0,
  );
  await expect.poll(() => stored(page)).toBe(0);
  expect(await storedRows(page, 'tempo-video-upload', 'drafts', 1)).toBe(0);
});
test('two foreground tabs send one durable operation once after reconnect', async ({
  page,
  context,
}) => {
  seed();
  await signIn(page);
  await page.goto('/measurements');
  const sibling = await context.newPage();
  await sibling.goto('/measurements');
  await expect(sibling.getByLabel('Заметка', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page
    .getByLabel('Заметка', { exact: true })
    .fill('Two-tab queued record');
  await page.getByLabel('Вес (кг)', { exact: true }).fill('74');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    page.getByText('Сохранено на устройстве', { exact: true }).first(),
  ).toBeVisible();
  let posts = 0;
  context.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/api/offline/writes' &&
      request.method() === 'POST'
    )
      posts++;
  });
  await context.setOffline(false);
  await Promise.all(
    [page, sibling].map((tab) =>
      tab.evaluate(() => window.dispatchEvent(new Event('online'))),
    ),
  );
  await expect
    .poll(() => {
      const db = new Database('.data/e2e.sqlite');
      try {
        return (
          db
            .prepare('SELECT count(*) as n FROM measurements WHERE note = ?')
            .get('Two-tab queued record') as { n: number }
        ).n;
      } finally {
        db.close();
      }
    })
    .toBe(1);
  await expect.poll(() => posts).toBe(1);
  await Promise.all(
    [page, sibling].map((tab) =>
      tab.evaluate(() => window.dispatchEvent(new Event('online'))),
    ),
  );
  await expect(page.getByText('Two-tab queued record').first()).toBeVisible();
  expect(posts).toBe(1);
});

test('an unsaved queue form survives reconnect, route return, and remount', async ({
  page,
  context,
}) => {
  page.on('dialog', (dialog) => dialog.accept());
  seed();
  await signIn(page);
  await page.goto('/measurements');
  await expect(page.getByLabel('Заметка', { exact: true })).toBeVisible();
  // Wait until the real owner write catalog is available locally.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open('yazio-offline-writes-v1', 1);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction('state', 'readonly');
              const row = tx.objectStore('state').get('current');
              row.onsuccess = () => resolve(!!row.result?.partition);
              tx.oncomplete = () => db.close();
            };
            request.onerror = () => reject(request.error);
          }),
      ),
    )
    .toBe(true);
  await context.setOffline(true);
  const queue = page.getByTestId('device-write-queue');
  await queue
    .getByRole('button', { name: 'Записать замер', exact: true })
    .click();
  await queue
    .getByRole('textbox', { name: 'Дата', exact: true })
    .fill('2026-08-14');
  await queue.getByLabel('Вес, кг', { exact: true }).fill('75.5');
  await queue
    .getByLabel('Заметка', { exact: true })
    .fill('Uncommitted queue draft');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(queue.getByLabel('Заметка', { exact: true })).toHaveValue(
    'Uncommitted queue draft',
  );
  await menu(page);
  await page.getByRole('link', { name: 'Обзор', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goBack();
  await expect(
    queue.getByRole('textbox', { name: 'Дата', exact: true }),
  ).toHaveValue('2026-08-14');
  await expect(queue.getByLabel('Вес, кг', { exact: true })).toHaveValue(
    '75.5',
  );
  await expect(queue.getByLabel('Заметка', { exact: true })).toHaveValue(
    'Uncommitted queue draft',
  );
  await page.reload();
  await expect(queue.getByLabel('Заметка', { exact: true })).toHaveValue(
    'Uncommitted queue draft',
  );
  await expect(
    queue.getByRole('textbox', { name: 'Дата', exact: true }),
  ).toHaveValue('2026-08-14');
  await expect(queue.getByLabel('Вес, кг', { exact: true })).toHaveValue(
    '75.5',
  );
  await queue.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(queue).toHaveCount(0);
  await page.reload();
  await expect(queue).toHaveCount(0);
});
