import { test, expect } from '../ci/isolated-test';
import { signInFixture } from '../ci/real-auth';
import { getSessionWith429Retry } from './auth-session';
import Database from 'better-sqlite3';
import { syntheticDay } from '../unit/reports/fixtures';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

test('optional steps goal persists, rejects invalid drafts and renders current goal in private reports', async ({
  page,
}, info) => {
  await signInFixture(page, 'owner');
  await page.goto('/settings#steps-goal');
  const section = page.locator('#steps-goal');
  const toggle = section.getByRole('switch', {
    name: 'Использовать цель шагов',
  });
  const save = section.getByRole('button', { name: 'Сохранить цель' });
  await expect(toggle).not.toBeChecked();
  await expect(section.getByLabel('Шагов в день')).toHaveCount(0);
  await toggle.check();
  const amount = section.getByLabel('Шагов в день');
  await expect(amount).toHaveValue('10000');
  await amount.fill('0');
  await save.click();
  await expect(
    section.getByText('Укажите положительное целое число шагов.'),
  ).toBeVisible();
  await amount.fill('10000');
  await page.route('**/api/settings/steps-goal', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await save.click();
  await expect(section.getByRole('alert')).toContainText(
    'Не удалось сохранить',
  );
  await expect(amount).toHaveValue('10000');
  await page.unroute('**/api/settings/steps-goal');
  await save.click();
  await expect(section.getByRole('status')).toHaveText('Цель сохранена.');
  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(amount).toHaveValue('10000');
  await expect(
    page
      .getByRole('navigation', { name: 'Разделы настроек' })
      .getByRole('link', { name: 'Цель шагов', exact: true }),
  ).toHaveAttribute('href', '#steps-goal');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await section.screenshot({ path: info.outputPath('steps-settings.png') });
  const session = await getSessionWith429Retry(page.request);
  const ownerId = session.user.id;
  const date = '2026-03-08';
  const db = new Database('.data/e2e.sqlite');
  db.prepare(
    'INSERT INTO nutrition_days(owner_id,date,snapshot,fetched_at) VALUES(?,?,?,?)',
  ).run(
    ownerId,
    date,
    JSON.stringify(syntheticDay(date)),
    '2026-10-15T00:00:00Z',
  );
  db.prepare(
    'INSERT INTO yazio_daily_steps(owner_id,date,steps,observed_at) VALUES(?,?,?,?)',
  ).run(ownerId, date, 12345, '2026-10-15T00:00:00Z');
  db.close();
  const params = new URLSearchParams({
    ownerId,
    start: date,
    end: date,
    period: 'daily',
    format: 'html',
  });
  try {
    await page.goto(`/api/reports?${params}`);
    await expect(page.locator('.steps-value')).toHaveText(/12[\s\u00a0]345/);
    await expect(page.locator('.goal-progress')).toHaveText('123% от цели');
    await expect(page.locator('.steps-track span')).toHaveAttribute(
      'style',
      'width:100%',
    );
    const order = await page
      .locator('.daily-totals')
      .evaluate((node) => [...node.children].map((child) => child.className));
    expect(order[0]).toBe('steps-column');
    const bounds = await page
      .locator('.steps-column,.total-column')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top };
        }),
      );
    if (info.project.name === 'mobile') {
      expect(bounds[0]!.top).toBe(bounds[1]!.top);
      expect(bounds[2]!.top).toBeGreaterThan(bounds[0]!.top);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('steps-report.png'),
      fullPage: true,
    });
    params.set('format', 'pdf');
    const response = await page.request.get(`/api/reports?${params}`);
    expect(response.status()).toBe(200);
    const path = info.outputPath('steps-goal.pdf');
    await writeFile(path, await response.body());
    const text = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' });
    expect(text).toContain('Текущая цель:');
    expect(text).toContain('123% от цели');
    await page.goto('/settings#steps-goal');
    await toggle.uncheck();
    await save.click();
    await expect(section.getByRole('status')).toContainText('Цель выключена');
    await page.reload();
    await expect(toggle).not.toBeChecked();
    params.set('format', 'html');
    await page.goto(`/api/reports?${params}`);
    await expect(page.locator('.steps-value')).toHaveText(/12[\s\u00a0]345/);
    await expect(page.locator('.steps-track,.goal-progress')).toHaveCount(0);
    await expect(page.getByText(/Текущая цель/)).toHaveCount(0);
  } finally {
    const cleanup = new Database('.data/e2e.sqlite');
    cleanup
      .prepare('DELETE FROM nutrition_days WHERE owner_id=? AND date=?')
      .run(ownerId, date);
    cleanup
      .prepare('DELETE FROM yazio_daily_steps WHERE owner_id=? AND date=?')
      .run(ownerId, date);
    cleanup.prepare('DELETE FROM owner_settings WHERE owner_id=?').run(ownerId);
    cleanup.close();
  }
});
