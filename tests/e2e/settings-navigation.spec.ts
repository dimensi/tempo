import { signInFixture } from '../ci/real-auth';
import { test, expect, type Page } from '../ci/isolated-test';
import Database from 'better-sqlite3';

async function login(page: Page) {
  return signInFixture(page, 'owner');
}

test('ready historical days are shown separately from downloaded food without an empty progress counter', async ({
  page,
}) => {
  const ownerId = await login(page);
  const database = new Database('.data/e2e.sqlite');
  const previous = database
    .prepare('SELECT status FROM nutrition_sync_runs WHERE owner_id = ?')
    .get(ownerId) as { status: string } | undefined;
  try {
    database
      .prepare(
        'INSERT OR REPLACE INTO nutrition_sync_runs(owner_id,status) VALUES (?,?)',
      )
      .run(
        ownerId,
        JSON.stringify({
          state: 'completed',
          startedAt: null,
          finishedAt: null,
          completedDates: [],
          skippedDates: ['2026-10-01', '2026-10-02'],
          failedDates: [],
          photoFailedDates: [],
        }),
      );
    await page.goto('/settings#sync');
    await expect(
      page.getByText('Уже загружено ранее: 2', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Загрузка еды: Загружено', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('(0/0)', { exact: false })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    if (previous)
      database
        .prepare('UPDATE nutrition_sync_runs SET status = ? WHERE owner_id = ?')
        .run(previous.status, ownerId);
    else
      database
        .prepare('DELETE FROM nutrition_sync_runs WHERE owner_id = ?')
        .run(ownerId);
    database.close();
  }
});

test('section navigation keeps form values through anchors and history', async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto('/settings');
  const navigation = page.getByRole('navigation', { name: 'Разделы настроек' });
  const startDate = page
    .getByLabel('Загрузить данные начиная с…')
    .filter({ visible: true });
  await startDate.fill('2026-10-01');
  await navigation
    .getByRole('link', { name: 'Синхронизация', exact: true })
    .click();
  await expect(page).toHaveURL('/settings#sync');
  await navigation
    .getByRole('link', { name: 'Доступ тренеров', exact: true })
    .click();
  await expect(page).toHaveURL('/settings#trainers');
  await expect(page.locator('#trainers')).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL('/settings#sync');
  await page.goForward();
  await expect(page).toHaveURL('/settings#trainers');
  await navigation
    .getByRole('link', { name: 'Подключение YAZIO', exact: true })
    .click();
  await expect(startDate).toHaveValue('2026-10-01');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (process.env.SETTINGS_SCREENSHOT_DIR) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({
      path: `${process.env.SETTINGS_SCREENSHOT_DIR}/settings-${testInfo.project.name}.png`,
      fullPage: true,
    });
  }
});

test('keyboard anchors focus the embedded section', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.goto('/settings#trainers');
  await expect(page).toHaveURL('/settings#trainers');
  const navigation = page.getByRole('navigation', { name: 'Разделы настроек' });
  const connection = navigation.getByRole('link', {
    name: 'Подключение YAZIO',
    exact: true,
  });
  await connection.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/settings#connection');
  await expect(page.locator('#connection')).toBeFocused();
  await expect(connection).toHaveAttribute('aria-current', 'location');
});

test('trainer form keeps values and request errors when navigating sections', async ({
  page,
}) => {
  await login(page);
  await page.goto('/settings#trainers');
  await page.route('**/api/trainers/invitations', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  const trainerEmail = page.getByRole('textbox', { name: 'Email тренера' });
  await trainerEmail.fill('synthetic-trainer@example.test');
  await page
    .getByRole('button', { name: 'Создать приглашение', exact: true })
    .click();
  await expect(page.locator('#trainers').getByRole('alert')).toHaveText(
    'Не удалось выполнить запрос',
  );
  const navigation = page.getByRole('navigation', { name: 'Разделы настроек' });
  await navigation
    .getByRole('link', { name: 'Подключение YAZIO', exact: true })
    .click();
  await page.goBack();
  await expect(trainerEmail).toHaveValue('synthetic-trainer@example.test');
  await expect(page.locator('#trainers').getByRole('alert')).toHaveText(
    'Не удалось выполнить запрос',
  );
});

test('hydration preserves an already focused settings anchor for keyboard activation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) =>
      url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js'),
    async (route) => {
      await scripts;
      await route.continue();
    },
  );
  try {
    await page.goto('/settings#trainers', { waitUntil: 'commit' });
    const navigation = page.getByRole('navigation', {
      name: 'Разделы настроек',
    });
    const connection = navigation.getByRole('link', {
      name: 'Подключение YAZIO',
      exact: true,
    });
    await connection.focus();
    await expect(connection).toBeFocused();
    release();
    await expect(
      page.getByLabel('Загрузить данные начиная с…').filter({ visible: true }),
    ).toBeEnabled();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(connection).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/settings#connection');
    await expect(page.locator('#connection')).toBeFocused();
    await expect(connection).toHaveAttribute('aria-current', 'location');
  } finally {
    release();
  }
});
