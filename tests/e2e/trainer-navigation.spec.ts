import Database from 'better-sqlite3';
import { testOrigin } from '../ci/origin';
import { expect, test } from '../ci/isolated-test';

for (const role of ['owner', 'trainer'] as const) {
  test(`${role} navigation exposes only available settings`, async ({
    page,
  }) => {
    const fixture = new Database('.data/e2e.sqlite');
    fixture
      .prepare(
        "INSERT OR REPLACE INTO trainer_access(trainer_id,owner_id,created_at) SELECT t.id,o.id,? FROM user t,user o WHERE t.email='trainer@example.test' AND o.email='owner@example.test'",
      )
      .run(Date.now());
    fixture.close();
    const signIn = () =>
      page.request.post('/api/auth/sign-in/email', {
        headers: { origin: testOrigin },
        data: {
          email: `${role}@example.test`,
          password: 'Test-only-password-12345',
        },
      });
    let response = await signIn();
    if (response.status() === 429) {
      const seconds = Number(
        response.headers()['x-retry-after'] ??
          response.headers()['retry-after'] ??
          10,
      );
      expect(Number.isFinite(seconds) && seconds >= 0).toBe(true);
      await page.waitForTimeout((seconds + 1) * 1000);
      response = await signIn();
    }
    expect(response.status()).toBe(200);
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Навигация', exact: true });
    if (await toggle.isVisible()) await toggle.click();
    const settings = page
      .getByRole('navigation', { name: 'Навигация', exact: true })
      .getByRole('link', { name: 'Настройки', exact: true });
    if (role === 'owner') {
      await expect(settings).toBeVisible();
      await expect(settings).toHaveAttribute('href', '/settings');
    } else {
      await expect(settings).toHaveCount(0);
      await page.goto('/settings');
      await expect(
        page.getByRole('heading', { name: 'Настройки', exact: true }),
      ).toBeVisible();
      expect((await page.request.get('/api/yazio/status')).status()).toBe(403);
    }
  });
}
