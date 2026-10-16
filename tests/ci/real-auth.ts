import { expect, test, type Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { testOrigin } from './origin';
import { getSessionWith429Retry } from '../e2e/auth-session';

// Test-scoped real HTTP authentication. Cookies belong to this browser context
// and the session belongs to this case's SQLite copy. No tokens cross resets.
// Login-form and throttling scenarios deliberately keep exercising their UI.
export async function signInFixture(
  page: Page,
  role: 'owner' | 'trainer' = 'owner',
) {
  const send = () =>
    page.request.post('/api/auth/sign-in/email', {
      headers: { origin: testOrigin },
      data: {
        email: `${role}@example.test`,
        password: 'Test-only-password-12345',
      },
    });
  let response = await send();
  if (response.status() === 429) {
    const retry =
      response.headers()['retry-after'] ?? response.headers()['x-retry-after'];
    expect(retry, 'Real sign-in throttle must provide Retry-After').toMatch(
      /^\d+(?:\.\d+)?$/,
    );
    const seconds = Number(retry);
    expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 60).toBe(
      true,
    );
    test.setTimeout(test.info().timeout + (seconds + 1) * 1000);
    await response.dispose();
    await delay((seconds + 1) * 1000);
    response = await send();
  }
  expect(response.status(), 'Real fixture sign-in succeeds').toBe(200);
  await response.dispose();
  const session = await getSessionWith429Retry(page.request);
  expect(session.user.email).toBe(`${role}@example.test`);
  expect(session.user.role).toBe(role.toUpperCase());
  if (role === 'owner') {
    await page.goto('/');
    await expect(page).toHaveURL('/');
  }
  return session.user.id;
}
