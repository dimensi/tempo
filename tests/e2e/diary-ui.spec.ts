import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

test('synthetic diary: exact values, photo confirmation, upload and mobile geometry', async ({
  page,
}) => {
  // Isolated browser component harness; security is covered by real login in diary.spec.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const bundle = await build({
    entryPoints: ['tests/e2e/diary-harness.tsx'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  await page.route('**/diary-component-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('/diary-component-test');
  await page.addStyleTag({
    content: await readFile('node_modules/@mantine/core/styles.css', 'utf8'),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  expect(errors).toEqual([]);
  await expect(page.getByText('Демонстрационные данные')).toBeVisible();
  await expect(page.getByText('123,456789 ккал').first()).toBeVisible();
  await expect(
    page.getByText('Масса: нет данных', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Оценка ИИ')).toBeVisible();
  await expect(page.getByText('Слот комментариев')).toBeVisible();
  const lunch = page.getByRole('region', { name: 'Обед', exact: true });
  await lunch.getByRole('button', { name: 'Удалить фото' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Отмена', exact: true })
    .click();
  await expect(lunch.getByText('Добавлено вручную')).toHaveCount(1);
  await lunch.getByRole('button', { name: 'Удалить фото' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Удалить фото', exact: true })
    .click();
  await expect(lunch.getByText('Добавлено вручную')).toHaveCount(0);
  await expect(lunch.getByText('Фото YAZIO', { exact: true })).toBeVisible();
  await expect(lunch.getByRole('button', { name: 'Удалить фото' })).toHaveCount(
    0,
  );
  const chooser = page.waitForEvent('filechooser');
  await lunch.getByRole('button', { name: 'Добавить фото' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: Buffer.from('synthetic'),
  });
  await expect(lunch.getByText('Добавлено вручную')).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
