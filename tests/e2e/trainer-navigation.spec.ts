import { expect, test } from '@playwright/test';

for (const role of ['owner', 'trainer'] as const) {
  test(`${role} navigation exposes only available settings`, async ({
    page,
  }) => {
    const signIn = () =>
      page.request.post('/api/auth/sign-in/email', {
        headers: { origin: `http://localhost:${process.env.E2E_PORT ?? 3100}` },
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
