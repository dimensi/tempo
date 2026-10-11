import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser } from '@playwright/test';
import { expect, it } from 'vitest';

const origin = 'http://localhost:3135';
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
      ['node_modules/next/dist/bin/next', 'dev', '--port', '3135'],
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
        throw new Error('Disposable test server exited');
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
    const owner = await browser.newPage();
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
    await expect(email.isEnabled()).resolves.toBe(true);
    expect(
      await owner
        .getByRole('textbox', { name: 'Существующий токен JSON', exact: true })
        .count(),
    ).toBe(0);
    await email.fill('failure@example.test');
    await secret.fill(password);
    await owner.getByRole('checkbox').check();
    const rejected = owner.waitForResponse((response) =>
      response.url().endsWith('/api/yazio/connect'),
    );
    await owner
      .getByRole('button', { name: 'Подключить YAZIO', exact: true })
      .click();
    expect((await rejected).status()).toBe(502);
    expect(await secret.inputValue()).toBe('');
    await owner
      .getByText('Не удалось выполнить запрос', { exact: true })
      .waitFor();
    expect(await email.isEnabled()).toBe(true);
    await email.fill('synthetic-yazio@example.test');
    await secret.fill(password);
    await owner.getByRole('checkbox').check();
    const connected = owner.waitForResponse((response) =>
      response.url().endsWith('/api/yazio/connect'),
    );
    await owner
      .getByRole('button', { name: 'Подключить YAZIO', exact: true })
      .click();
    expect((await connected).status()).toBe(200);
    expect(await secret.inputValue()).toBe('');
    await owner
      .getByRole('button', { name: 'Отключить YAZIO', exact: true })
      .waitFor();
    const envelope = await readFile(tokenPath, 'utf8');
    for (const value of [
      password,
      'synthetic-ui-access-only',
      'synthetic-ui-refresh-only',
      'synthetic-yazio@example.test',
    ])
      expect(envelope).not.toContain(value);
    expect(JSON.parse(envelope).version).toBe(1);
    await owner.reload();
    await owner
      .getByRole('button', { name: 'Отключить YAZIO', exact: true })
      .waitFor();
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
    await owner.getByText('Токен не подключён', { exact: true }).waitFor();
    await owner.reload();
    expect(
      (await (await owner.request.get(origin + '/api/yazio/status')).json())
        .configured,
    ).toBe(false);
    expect(await (await owner.request.get(dayUrl)).json()).toEqual(snapshot);
    expect(await (await owner.request.get(photosUrl)).json()).toEqual(photos);
    expect(await secret.inputValue()).toBe('');
    // Reuse the real session while restarting with the operator setting absent.
    // This covers the reported disabled-fields state and its visible explanation.
    await owner.goto('about:blank');
    server.kill('SIGTERM');
    await new Promise<void>((resolve) => server!.once('exit', () => resolve()));
    server = spawn(
      process.execPath,
      ['node_modules/next/dist/bin/next', 'dev', '--port', '3135'],
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
      .waitFor();
    expect(await email.isDisabled()).toBe(true);
    expect(await secret.isDisabled()).toBe(true);
    expect(
      await owner
        .getByRole('button', { name: 'Подключить YAZIO', exact: true })
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
