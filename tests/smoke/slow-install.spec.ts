import { expect, test } from '../ci/isolated-test';
test('normal login and logout do not install or wait for an offline shell', async ({
  page,
}) => {
  const shellRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/offline/'))
      shellRequests.push(request.url());
  });
  await page.goto('/login');
  await page.getByLabel('Электронная почта').fill('owner@example.test');
  await page
    .getByRole('textbox', { name: 'Пароль', exact: true })
    .fill('Test-only-password-12345');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL('/');
  const menu = page.getByRole('button', { name: 'Навигация', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/login');
  expect(
    (await page.request.get('/api/workouts?ownerId=unknown')).status(),
  ).toBe(401);
  expect(shellRequests).toEqual([]);
});
