import Database from 'better-sqlite3';
import { expect, test, type Page } from '../ci/isolated-test';
import { syntheticDay } from '../unit/reports/fixtures';
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

test('cached data survives a network failure in the ordinary Next page', async ({
  page,
}) => {
  seed();
  await signIn(page);
  await page.goto('/measurements');
  await expect(
    page.getByText('Synthetic cached observation').first(),
  ).toBeVisible();
  await expect.poll(() => stored(page)).toBeGreaterThan(0);
  await page.route('**/api/measurements?*', (route) => route.abort('failed'));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(
    page.getByText('Synthetic cached observation').first(),
  ).toBeVisible();
  await expect(page).toHaveURL('/measurements');
});
