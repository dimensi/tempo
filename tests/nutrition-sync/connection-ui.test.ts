import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser } from '@playwright/test';
import { expect, it } from 'vitest';

const port = process.env.NUTRITION_CONNECTION_E2E_PORT ?? '3135';
const origin = `http://localhost:${port}`;
const tokenPath = './.data/e2e-yazio-connection.json';
const password = 'Synthetic-YAZIO-password-only';
it('real owner connects/disconnects through UI with synthetic OAuth; clears passwords, encrypts tokens, and denies trainer/anonymous', async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: 'file:./.data/e2e.sqlite',
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: 'e2e-only-secret-not-a-production-secret-12345',
    YAZIO_TOKEN_FILE: tokenPath,
    UPLOADS_DIR: './.data/e2e-nutrition-uploads',
    DEMO_MODE: 'false',
    NODE_OPTIONS: '--import=./tests/nutrition-sync/connection-oauth-stub.mjs',
  };
  await unlink(tokenPath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/prepare-e2e.ts'], {
    env,
    stdio: 'pipe',
  });
  const fixture = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--conditions=react-server',
        '--import',
        'tsx',
        'tests/nutrition-sync/e2e-fixture.ts',
        'initial',
      ],
      {
        env: { ...env, UPLOADS_DIR: './.data/e2e-nutrition-uploads' },
        encoding: 'utf8',
      },
    ),
  ) as { ownerId: string };
  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  const output: string[] = [];
  try {
    server = spawn(
      process.execPath,
      ['node_modules/next/dist/bin/next', 'dev', '--port', port],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    server.stdout!.on('data', (chunk) => {
      output.push(String(chunk));
      if (output.length > 50) output.shift();
    });
    server.stderr!.on('data', (chunk) => {
      output.push(String(chunk));
      if (output.length > 50) output.shift();
    });
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (server.exitCode !== null)
        throw new Error(
          'Disposable test server exited: ' +
            output.slice(-10).join('').replaceAll(password, '[redacted]'),
        );
      try {
        if ((await fetch(origin + '/login')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(500);
    }
    expect(ready).toBe(true);
    browser = await chromium.launch();
    const ownerContext = await browser.newContext({
      timezoneId: 'Europe/Moscow',
    });
    const owner = await ownerContext.newPage();
    const errors: string[] = [];
    owner.on('pageerror', (error) => errors.push(error.message));
    const anonymous = await owner.request.post(origin + '/api/yazio/connect', {
      headers: { origin },
      data: { email: 'synthetic-yazio@example.test', password },
    });
    expect(anonymous.status()).toBe(401);
    expect(
      (
        await owner.request.post(origin + '/api/yazio/disconnect', {
          headers: { origin },
        })
      ).status(),
    ).toBe(401);
    await owner.goto(origin + '/login');
    await owner.getByLabel('Электронная почта').fill('owner@example.test');
    await owner
      .getByRole('textbox', { name: 'Пароль', exact: true })
      .fill('Test-only-password-12345');
    await owner.getByRole('button', { name: 'Войти', exact: true }).click();
    await owner.waitForURL(origin + '/');
    await owner.goto(origin + '/settings/yazio');
    const dayUrl =
      origin +
      '/api/nutrition/days/2026-01-01?ownerId=' +
      encodeURIComponent(fixture.ownerId);
    const snapshot = await (await owner.request.get(dayUrl)).json();
    const photosUrl =
      origin +
      '/api/nutrition/photos?ownerId=' +
      encodeURIComponent(fixture.ownerId) +
      '&from=2026-01-01&to=2026-01-01';
    const photos = await (await owner.request.get(photosUrl)).json();
    expect(photos).toHaveLength(1);
    await owner
      .getByRole('heading', { name: 'Подключение YAZIO', exact: true })
      .waitFor();
    const email = owner.getByRole('textbox', {
      name: 'Email аккаунта YAZIO',
      exact: true,
    });
    const secret = owner.getByRole('textbox', {
      name: 'Пароль YAZIO',
      exact: true,
    });
    await expect.poll(() => email.isEnabled(), { timeout: 10000 }).toBe(true);
    expect(
      await owner
        .getByRole('textbox', { name: 'Существующий токен JSON', exact: true })
        .count(),
    ).toBe(0);
    const beginning = owner.getByLabel('Загрузить данные начиная с…');
    const connectRequests: string[] = [];
    owner.on('request', (request) => {
      if (request.url().endsWith('/api/yazio/connect'))
        connectRequests.push(request.url());
    });
    await beginning.fill('9999-12-31');
    await email.fill('synthetic-yazio@example.test');
    await secret.fill(password);
    await owner.getByRole('checkbox').check();
    await owner
      .getByRole('button', {
        name: 'Подключить и загрузить дневник',
        exact: true,
      })
      .click();
    await owner
      .getByText(
        'Выберите корректный период до 366 дней, не позже сегодняшнего дня.',
        { exact: true },
      )
      .waitFor();
    expect(connectRequests).toHaveLength(0);
    expect(await secret.inputValue()).toBe('');
    await beginning.fill(new Date().toISOString().slice(0, 10));
    await email.fill('failure@example.test');
    await secret.fill(password);
    await owner.getByRole('checkbox').check();
    const rejected = owner.waitForResponse((response) =>
      response.url().endsWith('/api/yazio/connect'),
    );
    await owner
      .getByRole('button', {
        name: 'Подключить и загрузить дневник',
        exact: true,
      })
      .click();
    expect((await rejected).status()).toBe(502);
    expect(await secret.inputValue()).toBe('');
    await owner
      .getByText('Не удалось выполнить запрос', { exact: true })
      .waitFor();
    expect(await email.isEnabled()).toBe(true);
    expect(await owner.getByLabel('Конец периода').count()).toBe(0);
    const browserToday = await owner.evaluate(() =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(
        new Date(),
      ),
    );
    const chosenFrom = new Date(Date.parse(browserToday) - 3 * 86400000)
      .toISOString()
      .slice(0, 10);
    await beginning.fill(chosenFrom);
    const syncBodies: unknown[] = [];
    await owner.route('**/api/yazio/sync', async (route) => {
      syncBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'synthetic unavailable' }),
      });
    });
    await email.fill('synthetic-yazio@example.test');
    await secret.fill(password);
    await owner.getByRole('checkbox').check();
    const connected = owner.waitForResponse((response) =>
      response.url().endsWith('/api/yazio/connect'),
    );
    await owner
      .getByRole('button', {
        name: 'Подключить и загрузить дневник',
        exact: true,
      })
      .click();
    expect((await connected).status()).toBe(200);
    await owner
      .getByText(
        'YAZIO подключён, но дневник не удалось загрузить. Нажмите «Обновить сейчас», чтобы повторить.',
        { exact: true },
      )
      .waitFor();
    expect(await secret.count()).toBe(0);
    expect(syncBodies).toEqual([
      { mode: 'period', from: chosenFrom, timezone: 'Europe/Moscow' },
    ]);
    expect(
      (await (await owner.request.get(origin + '/api/yazio/status')).json())
        .configured,
    ).toBe(true);
    await owner.unroute('**/api/yazio/sync');
    await owner
      .getByRole('button', { name: 'Обновить сейчас', exact: true })
      .click();
    await owner.getByText('Дневник обновлён.', { exact: true }).waitFor();
    const updated = await (
      await owner.request.get(origin + '/api/yazio/status')
    ).json();
    expect(updated.schedule.enabled).toBe(true);
    expect(updated.schedule.timezone).toBe('Europe/Moscow');
    expect(updated.schedule.initialFrom).toBe(chosenFrom);
    expect(updated.schedule.lastSuccess).not.toBeNull();
    expect(updated.schedule.schedulerActive).toBe(false);
    await owner
      .getByText(
        'Автоматическое обновление пока не включено на сервере. Можно обновить сейчас.',
        { exact: true },
      )
      .waitFor();
    expect(updated.sync.completedDates).toHaveLength(4);
    expect(updated.sync.completedDates.at(-1)).toBe(browserToday);
    expect(
      await owner
        .getByRole('button', { name: 'Отключить YAZIO', exact: true })
        .count(),
    ).toBe(0);
    await owner.screenshot({
      path: join(tmpdir(), 'yazio-ux-connected.png'),
      fullPage: true,
    });
    const envelope = await readFile(tokenPath, 'utf8');
    for (const value of [
      password,
      'synthetic-ui-access-only',
      'synthetic-ui-refresh-only',
      'synthetic-yazio@example.test',
    ])
      expect(envelope).not.toContain(value);
    expect(JSON.parse(envelope).version).toBe(1);
    // Stored connection exists, but SSR controls must remain disabled while JS is delayed.
    const delayed = await owner.context().newPage();
    delayed.on('pageerror', (error) => errors.push(error.message));
    let releaseScripts!: () => void;
    const scripts = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    await delayed.route(
      (url) =>
        url.pathname.startsWith('/_next/static/') &&
        url.pathname.endsWith('.js'),
      async (route) => {
        await scripts;
        await route.continue();
      },
    );
    await delayed.goto(origin + '/settings/yazio', { waitUntil: 'commit' });
    const delayedStart = delayed.getByLabel('Загрузить данные начиная с…');
    await delayedStart.waitFor();
    expect(await delayedStart.isDisabled()).toBe(true);
    expect(
      await delayed
        .getByRole('button', { name: 'Обновить сейчас', exact: true })
        .isDisabled(),
    ).toBe(true);
    await expect(
      delayedStart.fill(chosenFrom, { timeout: 300 }),
    ).rejects.toThrow();
    releaseScripts();
    await expect
      .poll(() => delayedStart.isEnabled(), { timeout: 15000 })
      .toBe(true);
    await delayedStart.fill(chosenFrom);
    await delay(300);
    expect(await delayedStart.inputValue()).toBe(chosenFrom);
    await delayed.close();
    await owner.reload();
    await owner
      .getByRole('button', { name: 'Обновить сейчас', exact: true })
      .waitFor();
    expect(await beginning.inputValue()).toBe(chosenFrom);
    await owner
      .getByRole('button', { name: 'Дополнительные настройки', exact: true })
      .click();
    const trainer = await browser.newPage();
    await trainer.goto(origin + '/login');
    await trainer.getByLabel('Электронная почта').fill('trainer@example.test');
    await trainer
      .getByRole('textbox', { name: 'Пароль', exact: true })
      .fill('Test-only-password-12345');
    await trainer.getByRole('button', { name: 'Войти', exact: true }).click();
    await trainer.waitForURL(origin + '/');
    for (const path of ['connect', 'disconnect'])
      expect(
        (
          await trainer.request.post(origin + '/api/yazio/' + path, {
            headers: { origin },
            data: { email: 'synthetic-yazio@example.test', password },
          })
        ).status(),
      ).toBe(403);
    await owner
      .locator('#main-content')
      .getByRole('button', { name: 'Отключить YAZIO', exact: true })
      .click();
    const dialog = owner.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    expect(
      (await (await owner.request.get(origin + '/api/yazio/status')).json())
        .configured,
    ).toBe(true);
    await owner
      .locator('#main-content')
      .getByRole('button', { name: 'Отключить YAZIO', exact: true })
      .click();
    await owner
      .getByRole('dialog')
      .getByRole('button', { name: 'Отключить YAZIO', exact: true })
      .click();
    await owner.getByText('YAZIO не подключён', { exact: true }).waitFor();
    await owner.reload();
    expect(
      (await (await owner.request.get(origin + '/api/yazio/status')).json())
        .configured,
    ).toBe(false);
    expect(
      (await (await owner.request.get(origin + '/api/yazio/status')).json())
        .schedule.enabled,
    ).toBe(false);
    expect(await (await owner.request.get(dayUrl)).json()).toEqual(snapshot);
    expect(await (await owner.request.get(photosUrl)).json()).toEqual(photos);
    expect(await secret.inputValue()).toBe('');
    await email.fill('synthetic-yazio@example.test');
    await secret.fill(password);
    await owner.getByRole('checkbox').check();
    await owner
      .getByRole('button', {
        name: 'Подключить и загрузить дневник',
        exact: true,
      })
      .click();
    await owner
      .getByText('YAZIO подключён. Дневник загружен.', { exact: true })
      .waitFor();
    expect(
      await owner
        .getByRole('button', { name: 'Обновить сейчас', exact: true })
        .isEnabled(),
    ).toBe(true);
    expect(await owner.getByRole('checkbox').count()).toBe(0);
    // Reuse the real session while restarting with the operator setting absent.
    // This covers the reported disabled-fields state and its visible explanation.
    await owner.goto('about:blank');
    server.kill('SIGTERM');
    await new Promise<void>((resolve) => server!.once('exit', () => resolve()));
    server = spawn(
      process.execPath,
      ['node_modules/next/dist/bin/next', 'dev', '--port', port],
      {
        env: { ...env, YAZIO_TOKEN_FILE: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    server.stdout!.on('data', (chunk) => output.push(String(chunk)));
    server.stderr!.on('data', (chunk) => output.push(String(chunk)));
    for (let i = 0; i < 120; i++) {
      if (server.exitCode !== null)
        throw new Error('Disposable unconfigured server exited');
      try {
        if ((await fetch(origin + '/login')).ok) break;
      } catch {}
      await delay(500);
    }
    await owner.goto(origin + '/settings/yazio');
    await owner
      .getByText(
        'Подключение пока недоступно: администратору нужно настроить защищённое хранение подключения YAZIO.',
        { exact: true },
      )
      .filter({ visible: true })
      .waitFor();
    expect(await email.isDisabled()).toBe(true);
    expect(await secret.isDisabled()).toBe(true);
    expect(
      await owner
        .getByRole('button', {
          name: 'Подключить и загрузить дневник',
          exact: true,
        })
        .isDisabled(),
    ).toBe(true);
    expect(errors).toEqual([]);
    for (const line of output) expect(line).not.toContain(password);
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise<void>((resolve) =>
        server!.once('exit', () => resolve()),
      );
    }
    await unlink(tokenPath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}, 120000);
