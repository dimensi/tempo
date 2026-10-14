import { test, expect } from '../ci/isolated-test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

test('meal visibility retains real zeros, photos and noncalorie nutrients while empty days have one state', async ({
  page,
}) => {
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
      body: '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.route('**/synthetic-photo', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#1971c2"/></svg>',
    }),
  );
  async function open(fixture: string) {
    await page.goto(`/diary-component-test?fixture=${fixture}`);
    await page.addStyleTag({
      content: await readFile('node_modules/@mantine/core/styles.css', 'utf8'),
    });
    await page.addStyleTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.css'))!
        .text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!
        .text,
    });
  }
  const mealHeadings = () => page.getByRole('heading', { level: 2 });
  await open('absent');
  await expect(mealHeadings()).toHaveCount(0);
  await expect(
    page.getByText('Данные за этот день пока не загружены.', { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('region', { name: 'Итоги дня', exact: true }),
  ).toHaveCount(0);
  for (const fixture of ['zero', 'null-empty']) {
    await open(fixture);
    await expect(mealHeadings()).toHaveCount(0);
    await expect(
      page.getByText('За этот день нет записей питания.', { exact: true }),
    ).toHaveCount(1);
    const summary = page.getByRole('region', {
      name: 'Итоги дня',
      exact: true,
    });
    await expect(summary).toBeVisible();
    await expect(
      summary
        .getByText(fixture === 'zero' ? '0 ккал' : 'нет данных', {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText('Слот комментариев', { exact: true }),
    ).toBeVisible();
  }
  await open('zero-entry');
  await expect(mealHeadings()).toHaveCount(1);
  await expect(
    page.getByRole('region', { name: 'Обед', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Синтетическая нулевая запись', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Масса: 0 г', { exact: true })).toBeVisible();
  await expect(
    page.getByText('За этот день нет записей питания.', { exact: true }),
  ).toHaveCount(0);
  await open('photo-only');
  await expect(mealHeadings()).toHaveCount(1);
  const dinner = page.getByRole('region', { name: 'Ужин', exact: true });
  await expect(dinner.getByRole('img')).toHaveCount(1);
  await expect(
    dinner.getByRole('button', {
      name: 'Увеличить фото: Ужин — Фото YAZIO',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dinner.getByText('Итого по записям', { exact: true }),
  ).toHaveCount(0);
  await open('nutrient-only');
  await expect(mealHeadings()).toHaveCount(1);
  const breakfast = page.getByRole('region', { name: 'Завтрак', exact: true });
  await expect(
    breakfast.getByText('0 ккал', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    breakfast.getByText('2 г', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Фотографии приёма пищи', { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('img')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('diary-meal-visibility.png'),
    fullPage: true,
  });
});
