import { test, expect } from '@playwright/test';

test('held initial offline install cannot delay real logout behind a cache lock', async ({
  page,
  request,
}) => {
  test.skip(
    test.info().project.name !== 'desktop',
    'The held-install diagnostic uses the desktop logout button; mobile privacy is covered separately.',
  );
  let signOutCount = 0;
  let signOutStatus: number | undefined;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/auth/sign-out')) signOutCount++;
  });
  page.on('response', (r) => {
    if (r.url().endsWith('/api/auth/sign-out')) signOutStatus = r.status();
  });
  await request.post('/__offline-test/control', { data: { hold: true } });
  try {
    await page.goto('/login');
    await page.getByLabel('Электронная почта').fill('owner@example.test');
    await page
      .getByRole('textbox', { name: 'Пароль', exact: true })
      .fill('Test-only-password-12345');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect
      .poll(
        async () =>
          (await (await request.get('/__offline-test/activity')).json()).held,
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await navigator.locks.query()).held?.some(
            (lock) =>
              lock.name === 'yazio-offline-mutation' && lock.mode === 'shared',
          ),
        ),
      )
      .toBe(true);
    await page.evaluate(() => {
      const marker = document.createElement('div');
      marker.dataset.offlinePrivate = '';
      marker.id = 'synthetic-private-marker';
      marker.textContent = 'Synthetic private content';
      document.body.append(marker);
    });
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    const locks = await page.evaluate(async () => {
      const state = await navigator.locks.query();
      return {
        held: state.held
          ?.filter((lock) => lock.name === 'yazio-offline-mutation')
          .map((lock) => ({ name: lock.name, mode: lock.mode })),
        pending: state.pending
          ?.filter((lock) => lock.name === 'yazio-offline-mutation')
          .map((lock) => ({ name: lock.name, mode: lock.mode })),
        busy: document.querySelector('button[data-loading]') !== null,
        concealed: document.getElementById('synthetic-private-marker')?.hidden,
      };
    });
    console.log(
      'SAFE held-install logout state',
      JSON.stringify({ ...locks, signOutCount, signOutStatus }),
    );
    expect(locks.concealed).toBe(true);
    await expect.poll(() => signOutStatus, { timeout: 5000 }).toBe(200);
    await expect(page).toHaveURL('/login');
    expect(
      (await page.request.get('/api/workouts?ownerId=unknown')).status(),
    ).toBe(401);
  } finally {
    await request.post('/__offline-test/control', { data: { hold: false } });
  }
});
