import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

test('synthetic diary: one computed total, honest comparisons, existing photos and mobile geometry', async ({
  page,
}) => {
  // Isolated browser component harness; security is covered by real login in diary.spec.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const bundle = await build({
    entryPoints: ['tests/e2e/diary-harness.tsx'],
    bundle: true,
    write: false,
    outdir: '.tmp/diary-harness',
    format: 'iife',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  await page.route('**/diary-component-test*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.route('**/synthetic-photo', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#e7ece4"/><circle cx="320" cy="240" r="184" fill="#fff"/><circle cx="270" cy="220" r="80" fill="#bfd294"/><circle cx="385" cy="260" r="62" fill="#d98b55"/><text x="320" y="430" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#334329">Synthetic meal photo</text></svg>',
    }),
  );
  await page.goto('/diary-component-test');
  await page.addStyleTag({
    content: await readFile('node_modules/@mantine/core/styles.css', 'utf8'),
  });
  await page.addStyleTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.css'))!
      .text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
  });
  expect(errors).toEqual([]);
  await expect(page.getByText('Демонстрационные данные')).toBeVisible();
  await expect(page.getByText('123,46 ккал').first()).toBeVisible();
  await expect(
    page.getByText('Масса: нет данных', { exact: true }),
  ).toHaveCount(0);
  const summary = page.getByRole('region', { name: 'Итоги дня', exact: true });
  await expect(
    summary.getByText('Итого по записям', { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByText('Итог по записям отличается от сводки YAZIO', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    summary.getByText('По сводке YAZIO', { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Добавить фото', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath('diary-default.png'),
    fullPage: true,
  });
  await summary
    .getByRole('button', { name: 'Сравнить со сводкой YAZIO', exact: true })
    .click();
  await expect(
    summary.getByText('Известная часть', { exact: true }),
  ).toBeVisible();
  await expect(summary.locator('[title="3.4499999999999997"]')).toHaveText(
    '3,45 г',
  );
  await expect(summary.locator('[title="6.1499999999999995"]')).toHaveText(
    '6,15 г',
  );
  await expect(summary.locator('[title="3e-16"]')).toHaveText('≈ 0 г');
  await expect(
    page.getByText(
      'Масса не указана в данных YAZIO. По количеству порций её определить нельзя.',
    ),
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('number-display.png'),
    fullPage: true,
  });
  await page.goto('/diary-component-test?fixture=zero');
  await page.addStyleTag({
    content: await readFile('node_modules/@mantine/core/styles.css', 'utf8'),
  });
  await page.addStyleTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.css'))!
      .text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
  });
  const zeroSummary = page.getByRole('region', {
    name: 'Итоги дня',
    exact: true,
  });
  await expect(
    zeroSummary.getByText('Итого по записям', { exact: true }),
  ).toBeVisible();
  await expect(zeroSummary.getByRole('alert')).toHaveCount(0);
  const visibleCalories = zeroSummary
    .getByText('0 ккал', { exact: true })
    .filter({ visible: true });
  await expect(visibleCalories).toHaveCount(1);
  await expect(visibleCalories).toBeVisible();
  expect((await zeroSummary.boundingBox())!.height).toBeLessThan(
    page.viewportSize()!.height / 2,
  );
  await expect(
    page.getByRole('button', { name: 'Добавить фото', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath('diary-zero.png'),
    fullPage: true,
  });
  await expect(
    zeroSummary.getByLabel('Соотношение БЖУ по массе', { exact: true }),
  ).toHaveCount(0);
  await page.goto('/diary-component-test?fixture=complete');
  await page.addStyleTag({
    content: await readFile('node_modules/@mantine/core/styles.css', 'utf8'),
  });
  await page.addStyleTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.css'))!
      .text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
  });
  await expect(
    page
      .getByRole('region', { name: 'Итоги дня', exact: true })
      .getByLabel('Соотношение БЖУ по массе', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Количество: 0', { exact: true })).toBeVisible();
  await expect(page.getByText('Масса: 0 г', { exact: true })).toBeVisible();
  await expect(page.locator('img[src="/wrong-photo"]')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Ужин', exact: true }).getByRole('img'),
  ).toHaveCount(1);
  await expect(
    page.getByRole('region', { name: 'Завтрак', exact: true }).getByRole('img'),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath('diary-complete.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
