import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import type { TransformMateConnectionStatus } from '@/contracts/transformmate-connection';

test('connection form clears synthetic credentials and confirms disconnect without exposing upstream errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let status: TransformMateConnectionStatus = {
    configured: false,
    account: null,
    checkedAt: null,
    errorCode: null,
  };
  let failConnect = true;
  let disconnects = 0;
  const connects: unknown[] = [];
  await page.route('**/api/transformmate/*', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1);
    if (action === 'connect') {
      connects.push(route.request().postDataJSON());
      if (failConnect)
        return route.fulfill({
          status: 503,
          json: { error: 'synthetic-refresh-secret' },
        });
      status = {
        configured: true,
        account: {
          id: 7,
          name: 'Тестовый аккаунт',
          email: 'synthetic@example.test',
        },
        checkedAt: '2026-10-12T00:00:00Z',
        errorCode: null,
      };
    }
    if (action === 'check')
      return route.fulfill({
        status: 502,
        json: {
          error: 'synthetic-refresh-secret',
          errorCode: 'reauth_required',
        },
      });
    if (action === 'disconnect') {
      disconnects++;
      expect(route.request().postDataJSON()).toEqual({});
      status = {
        configured: false,
        account: null,
        checkedAt: null,
        errorCode: null,
      };
    }
    return route.fulfill({
      json: { contractVersion: 1, source: 'user', data: status },
    });
  });
  const bundle = await build({
    entryPoints: ['tests/e2e/transformmate-connection-harness.tsx'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  await page.route('**/transformmate-form-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('/transformmate-form-test');
  await page.addStyleTag({
    content: await readFile('node_modules/@mantine/core/styles.css', 'utf8'),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const key = page.getByLabel('Firebase API key');
  const token = page.getByLabel('Firebase refresh token');
  await expect(
    page.getByRole('button', { name: 'Подключить', exact: true }),
  ).toBeEnabled();
  await expect(key).toHaveAttribute('type', 'password');
  await expect(token).toHaveAttribute('autocomplete', 'off');
  await key.fill('synthetic-api-key');
  await token.fill('synthetic-refresh-secret');
  await token.press('Enter');
  await expect(page.getByRole('alert')).toContainText(
    'Не удалось выполнить действие',
  );
  await expect(key).toHaveValue('');
  await expect(token).toHaveValue('');
  await expect(page.locator('body')).not.toContainText(
    'synthetic-refresh-secret',
  );
  expect(connects[0]).toEqual({
    apiKey: 'synthetic-api-key',
    refreshToken: 'synthetic-refresh-secret',
  });
  failConnect = false;
  await key.fill('synthetic-api-key');
  await token.fill('synthetic-refresh-secret');
  await page.getByRole('button', { name: 'Подключить', exact: true }).click();
  await expect(
    page.getByText('Тестовый аккаунт', { exact: true }),
  ).toBeVisible();
  await expect(key).toHaveCount(0);
  await expect(token).toHaveCount(0);
  await page.getByRole('button', { name: 'Проверить подключение' }).click();
  await expect(
    page.getByText('Подключение больше не действует.', { exact: false }),
  ).toBeVisible();
  await expect(key).toHaveValue('');
  await expect(token).toHaveValue('');
  await page.getByRole('button', { name: 'Отключить', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(modal).not.toBeVisible();
  expect(disconnects).toBe(0);
  await page.getByRole('button', { name: 'Отключить', exact: true }).click();
  await modal.getByRole('button', { name: 'Отключить', exact: true }).click();
  await expect(modal).not.toBeVisible();
  expect(disconnects).toBe(1);
  await expect(key).toHaveValue('');
  await expect(token).toHaveValue('');
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain('synthetic');
  expect(page.url()).not.toContain('synthetic');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('connection-disconnected.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
