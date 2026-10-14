import { testOrigin } from '../ci/origin';
import { get } from 'node:https';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser } from '@playwright/test';
import { expect, it } from 'vitest';

const origin = testOrigin;
async function readyResponse() {
  return new Promise<boolean>((resolve) => {
    const r = get(
      origin + '/login',
      { rejectUnauthorized: false },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    r.on('error', () => resolve(false));
  });
}
const tokenPath = './.data/e2e-yazio-connection.json';
const password = 'Synthetic-YAZIO-password-only';
it('real owner connects/disconnects through UI with synthetic OAuth; clears passwords, encrypts tokens, and denies trainer/anonymous', async () => {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: 'development',
    DATABASE_URL: 'file:./.data/e2e.sqlite',
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: 'offline-production-synthetic-secret-1234567890',
    YAZIO_TOKEN_FILE: tokenPath,
    UPLOADS_DIR: './.data/e2e-nutrition-uploads',
    DEMO_MODE: 'false',
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
      [
        '--import',
        'tsx',
        'tests/offline/production-runner.ts',
        'nutrition-connection',
      ],
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
        if (await readyResponse()) {
          ready = true;
          break;
        }
      } catch {}
      await delay(500);
    }
    expect(ready).toBe(true);
    browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
    const ownerContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
      timezoneId: 'Europe/Moscow',
    });
    await ownerContext.route('https://images.yazio-cdn.com/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKxkAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
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
    await owner.goto(origin + '/settings#connection');
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
      .getByRole('heading', { name: 'Аккаунт YAZIO', level: 2, exact: true })
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
    const beginning = owner
      .getByLabel('Загрузить данные начиная с…')
      .filter({ visible: true });
    const connectRequests: string[] = [];
    owner.on('request', (request) => {
      if (request.url().endsWith('/api/yazio/connect'))
        connectRequests.push(request.url());
    });
    await beginning.fill('9999-12-31');
    await email.fill('synthetic-yazio@example.test');
    await secret.fill(password);
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
    expect(await owner.getByLabel('Конец периода').isVisible()).toBe(false);
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
    owner.on('request', (request) => {
      if (request.url().endsWith('/api/yazio/sync'))
        syncBodies.push(request.postDataJSON());
    });
    await email.fill('synthetic-fail-sync@example.test');
    await secret.fill(password);
    await owner.evaluate(() => {
      location.hash = 'sync';
    });
    expect(await beginning.inputValue()).toBe(chosenFrom);
    expect(await secret.inputValue()).toBe(password);
    await owner.evaluate(() => {
      location.hash = 'connection';
    });
    expect(await beginning.inputValue()).toBe(chosenFrom);
    expect(await owner.locator('#connection').getAttribute('tabindex')).toBe(
      '-1',
    );
    expect(await owner.locator('#sync').getAttribute('tabindex')).toBe('-1');
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
        'YAZIO подключён. Не удалось полностью загрузить дневник. Нажмите «Обновить сейчас», чтобы повторить.',
        { exact: true },
      )
      .waitFor();
    expect(await secret.count()).toBe(0);
    expect(await owner.getByRole('checkbox').count()).toBe(0);
    expect(syncBodies).toEqual([]); // Initial backfill is part of the server connect request.
    expect(
      (await (await owner.request.get(origin + '/api/yazio/status')).json())
        .configured,
    ).toBe(true);
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
        .isVisible(),
    ).toBe(true);
    await owner
      .getByText('synthetic-yazio@example.test', { exact: true })
      .waitFor();
    expect(
      await owner
        .getByRole('img', { name: 'Аккаунт YAZIO' })
        .getAttribute('src'),
    ).toContain('images.yazio-cdn.com/synthetic-avatar.png');
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
    await delayed.goto(origin + '/settings#connection', {
      waitUntil: 'commit',
    });
    const delayedStart = delayed
      .getByLabel('Загрузить данные начиная с…')
      .filter({ visible: true });
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
    // A legacy UTC schedule must still display timestamps in this browser's Moscow clock.
    expect(
      (
        await owner.request.post(origin + '/api/yazio/connect', {
          headers: { origin },
          data: {
            email: 'synthetic-yazio@example.test',
            password,
            timezone: 'UTC',
            initialFrom: chosenFrom,
          },
        })
      ).status(),
    ).toBe(200);
    const legacy = await (
      await owner.request.get(origin + '/api/yazio/status')
    ).json();
    expect(legacy.schedule.timezone).toBe('UTC');
    await owner.reload();
    await owner
      .getByRole('button', { name: 'Обновить сейчас', exact: true })
      .waitFor();
    const browserSuccess = new Date(legacy.schedule.lastSuccess).toLocaleString(
      'ru-RU',
      { timeZone: 'Europe/Moscow' },
    );
    await owner
      .getByText('Последнее успешное обновление: ' + browserSuccess, {
        exact: true,
      })
      .waitFor();
    expect(browserSuccess).not.toBe(
      new Date(legacy.schedule.lastSuccess).toLocaleString('ru-RU', {
        timeZone: 'UTC',
      }),
    );
    expect(await beginning.inputValue()).toBe(chosenFrom);
    await owner
      .getByRole('button', { name: 'Дополнительные настройки', exact: true })
      .click();
    const trainer = await browser.newPage({
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
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
    const departing = await ownerContext.newPage();
    await departing.goto(origin + '/settings#connection');
    await departing
      .getByLabel('Загрузить данные начиная с…')
      .filter({ visible: true })
      .fill(chosenFrom);
    await departing
      .getByRole('textbox', { name: 'Email аккаунта YAZIO', exact: true })
      .fill('synthetic-close-browser@example.test');
    await departing
      .getByRole('textbox', { name: 'Пароль YAZIO', exact: true })
      .fill(password);
    await departing
      .getByRole('button', {
        name: 'Подключить и загрузить дневник',
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await (await owner.request.get(origin + '/api/yazio/status')).json())
            .schedule.running,
        { timeout: 15000 },
      )
      .toBe(true);
    await departing.close();
    await expect
      .poll(
        async () =>
          (await (await owner.request.get(origin + '/api/yazio/status')).json())
            .schedule.running,
        { timeout: 15000 },
      )
      .toBe(false);
    const closedBrowserResult = await (
      await owner.request.get(origin + '/api/yazio/status')
    ).json();
    expect(closedBrowserResult.configured).toBe(true);
    expect(closedBrowserResult.sync.state).toBe('completed');
    expect(closedBrowserResult.sync.completedDates).toHaveLength(4);
    await owner.reload();
    await expect
      .poll(
        () =>
          owner
            .getByRole('button', { name: 'Обновить сейчас', exact: true })
            .isEnabled(),
        { timeout: 10000 },
      )
      .toBe(true);
    expect(
      await owner
        .getByRole('textbox', { name: 'Пароль YAZIO', exact: true })
        .count(),
    ).toBe(0);
    expect(await owner.getByRole('checkbox').count()).toBe(0);
    // Reuse the real session while restarting with the operator setting absent.
    // This covers the reported disabled-fields state and its visible explanation.
    await owner.goto('about:blank');
    server.kill('SIGTERM');
    await new Promise<void>((resolve) => server!.once('exit', () => resolve()));
    server = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        'tests/offline/production-runner.ts',
        'nutrition-connection',
      ],
      {
        env: { ...env, CI_YAZIO_UNCONFIGURED: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    server.stdout!.on('data', (chunk) => output.push(String(chunk)));
    server.stderr!.on('data', (chunk) => output.push(String(chunk)));
    for (let i = 0; i < 120; i++) {
      if (server.exitCode !== null)
        throw new Error('Disposable unconfigured server exited');
      try {
        if (await readyResponse()) break;
      } catch {}
      await delay(500);
    }
    await owner.goto(origin + '/settings#connection');
    await owner
      .locator('#connection')
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

it.each(['desktop', 'mobile'])(
  'real owner saves six body fields, pulls without echo, resolves lost POST and outage, and retains real trainer denials (%s)',
  async (surface) => {
    const { writeFile } = await import('node:fs/promises');
    const controlPath = './.data/e2e-yazio-body-control.json',
      statePath = './.data/e2e-yazio-body-state.json';
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      NODE_ENV: 'development',
      DATABASE_URL: 'file:./.data/e2e.sqlite',
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: 'offline-production-synthetic-secret-1234567890',
      YAZIO_TOKEN_FILE: tokenPath,
      UPLOADS_DIR: './.data/e2e-nutrition-uploads',
      DEMO_MODE: 'false',
    };
    await unlink(tokenPath).catch(() => {});
    execFileSync('pnpm', ['exec', 'tsx', 'scripts/prepare-e2e.ts'], {
      env,
      stdio: 'pipe',
    });
    const control = {
      runId: 'six-body-fields',
      mode: 'healthy',
      version: 1,
      remoteUpdates: {} as Record<string, number>,
    };
    const setControl = () => writeFile(controlPath, JSON.stringify(control));
    await setControl();
    let server: ChildProcess | undefined, browser: Browser | undefined;
    try {
      server = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          'tests/offline/production-runner.ts',
          'nutrition-connection',
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      server.stdout!.resume();
      server.stderr!.resume();
      let ready = false;
      for (let index = 0; index < 120; index++) {
        if (server.exitCode !== null)
          throw new Error('Synthetic body production server exited');
        if (await readyResponse()) {
          ready = true;
          break;
        }
        await delay(500);
      }
      expect(ready).toBe(true);
      browser = await chromium.launch({
        args: ['--ignore-certificate-errors'],
      });
      const owner = await browser.newPage({
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
        timezoneId: 'UTC',
        ...(surface === 'mobile'
          ? {
              viewport: { width: 390, height: 844 },
              isMobile: true,
              hasTouch: true,
            }
          : {}),
      });
      await owner.goto(origin + '/login');
      await owner.getByLabel('Электронная почта').fill('owner@example.test');
      await owner
        .getByRole('textbox', { name: 'Пароль', exact: true })
        .fill('Test-only-password-12345');
      await owner.getByRole('button', { name: 'Войти', exact: true }).click();
      await owner.waitForURL(origin + '/');
      const ownerId = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--conditions=react-server',
            '--import',
            'tsx',
            'tests/nutrition-sync/e2e-fixture.ts',
            'grant',
          ],
          { env, encoding: 'utf8' },
        ),
      ).ownerId as string;
      const today = await owner.evaluate(() =>
        new Intl.DateTimeFormat('sv-SE').format(new Date()),
      );
      const scope = `ownerId=${encodeURIComponent(ownerId)}`;
      const historical = await owner.request.post(
        origin + '/api/measurements?' + scope,
        {
          headers: { origin },
          data: {
            measuredAt: '2026-01-01',
            values: [{ metric: 'weight', value: '75', unit: 'kg' }],
            note: 'Historical local only',
          },
        },
      );
      expect(historical.status()).toBe(201);
      const connected = await owner.request.post(
        origin + '/api/yazio/connect',
        {
          headers: { origin },
          data: {
            email: 'synthetic-yazio@example.test',
            password,
            timezone: 'UTC',
            initialFrom: today,
          },
        },
      );
      expect(connected.ok()).toBe(true);
      const state = async () =>
        JSON.parse(await readFile(statePath, 'utf8')) as {
          creates: number;
          updates: number;
          entries: Record<
            string,
            { id: string; value: number; date: string }[]
          >;
        };
      expect((await state()).creates).toBe(0);
      await owner.goto(origin + '/measurements');
      const main = owner.getByRole('main');
      const measurementDate = owner.getByRole('main').getByLabel('Дата замера');
      await measurementDate.waitFor();
      expect(await measurementDate.count()).toBe(1);
      await measurementDate.fill(today);
      for (const [label, value] of [
        ['Вес (кг)', '80.5'],
        ['Талия (см)', '90'],
        ['Грудь (см)', '100'],
        ['Бёдра (см)', '95'],
        ['Бедро (см)', '55'],
        ['Бицепс (обхват плеча) (см)', '35'],
        ['Шея (см)', '40'],
      ]) {
        const field = main.getByLabel(label!, { exact: true });
        expect(await field.count()).toBe(1);
        await field.fill(value!);
      }
      await main
        .getByLabel('Заметка', { exact: true })
        .fill('Keep neck and note');
      await main
        .getByRole('button', { name: 'Сохранить', exact: true })
        .click();
      const records = async () =>
        (await (
          await owner.request.get(origin + '/api/measurements?' + scope)
        ).json()) as {
          id: string;
          measuredAt: string;
          note: string | null;
          values: { metric: string; value: string }[];
          sync: { metric: string; state: string }[];
        }[];
      await expect
        .poll(
          async () =>
            (await records())
              .find((row) => row.note === 'Keep neck and note')
              ?.sync.filter((s) => s.state === 'synced').length,
          { timeout: 15000 },
        )
        .toBe(6);
      let saved = (await records()).find(
        (row) => row.note === 'Keep neck and note',
      )!;
      expect(saved.values).toHaveLength(7);
      expect((await state()).creates).toBe(6);
      expect(Object.keys((await state()).entries).sort()).toEqual(
        [
          'circumference.arm',
          'circumference.chest',
          'circumference.hip',
          'circumference.thigh',
          'circumference.waist',
          'weight',
        ].sort(),
      );
      const weightId = (await state()).entries.weight![0]!.id;
      control.version++;
      control.remoteUpdates = { [weightId]: 79.5 };
      await setControl();
      expect(
        (
          await owner.request.post(origin + '/api/yazio/sync', {
            headers: { origin },
            data: { mode: 'period', from: today, timezone: 'UTC' },
          })
        ).ok(),
      ).toBe(true);
      saved = (await records()).find((row) => row.id === saved.id)!;
      expect(saved.values.find((v) => v.metric === 'weight')?.value).toBe(
        '79.5',
      );
      expect(saved.values.find((v) => v.metric === 'neck')?.value).toBe('40');
      expect(saved.note).toBe('Keep neck and note');
      expect((await state()).creates).toBe(6);
      expect((await state()).updates).toBe(0);
      control.mode = 'post_lost';
      await setControl();
      const lost = await owner.request.post(
        origin + '/api/measurements?' + scope,
        {
          headers: { origin },
          data: {
            measuredAt: today,
            values: [{ metric: 'waist', value: '91', unit: 'cm' }],
            note: 'Lost POST',
          },
        },
      );
      const lostId = (await lost.json()).id as string;
      await expect
        .poll(
          async () =>
            (await records()).find((row) => row.id === lostId)?.sync[0]?.state,
          { timeout: 15000 },
        )
        .toBe('uncertain');
      const before = (await state()).creates;
      control.mode = 'healthy';
      await setControl();
      expect(
        (
          await owner.request.post(
            origin + `/api/measurements/${lostId}/retry?` + scope,
            { headers: { origin } },
          )
        ).ok(),
      ).toBe(true);
      await expect
        .poll(
          async () =>
            (await records()).find((row) => row.id === lostId)?.sync[0]?.state,
          { timeout: 15000 },
        )
        .toBe('synced');
      expect((await state()).creates).toBe(before);
      control.mode = 'outage';
      await setControl();
      const changed = {
        measuredAt: today,
        values: saved.values.map((v) => ({
          ...v,
          unit: v.metric === 'weight' ? 'kg' : 'cm',
          value: v.metric === 'weight' ? '81' : v.value,
        })),
        note: saved.note,
      };
      expect(
        (
          await owner.request.put(
            origin + `/api/measurements/${saved.id}?` + scope,
            { headers: { origin }, data: changed },
          )
        ).ok(),
      ).toBe(true);
      await expect
        .poll(
          async () =>
            (await records())
              .find((row) => row.id === saved.id)
              ?.sync.find((s) => s.metric === 'weight')?.state,
          { timeout: 15000 },
        )
        .toBe('failed');
      control.mode = 'healthy';
      await setControl();
      await owner.goto(origin + '/measurements');
      await main
        .getByRole('row')
        .filter({ hasText: 'Keep neck and note' })
        .getByRole('button', { name: 'Повторить отправку', exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await records())
              .find((row) => row.id === saved.id)
              ?.sync.find((s) => s.metric === 'weight')?.state,
          { timeout: 15000 },
        )
        .toBe('synced');
      expect((await state()).updates).toBe(1);
      const trainer = await browser.newPage({
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
      });
      await trainer.goto(origin + '/login');
      await trainer
        .getByLabel('Электронная почта')
        .fill('trainer@example.test');
      await trainer
        .getByRole('textbox', { name: 'Пароль', exact: true })
        .fill('Test-only-password-12345');
      await trainer.getByRole('button', { name: 'Войти', exact: true }).click();
      await trainer.waitForURL(origin + '/');
      expect(
        (
          await trainer.request.get(origin + '/api/measurements?' + scope)
        ).status(),
      ).toBe(200);
      expect(
        (
          await trainer.request.post(
            origin + `/api/measurements/${saved.id}/retry?` + scope,
            { headers: { origin } },
          )
        ).status(),
      ).toBe(403);
      expect(
        (
          await trainer.request.post(origin + '/api/measurements?' + scope, {
            headers: { origin },
            data: changed,
          })
        ).status(),
      ).toBe(403);
      execFileSync(
        process.execPath,
        [
          '--conditions=react-server',
          '--import',
          'tsx',
          'tests/nutrition-sync/e2e-fixture.ts',
          'revoke',
        ],
        { env, stdio: 'pipe' },
      );
      expect(
        (
          await trainer.request.get(origin + '/api/measurements?' + scope)
        ).status(),
      ).toBe(403);
      expect(
        (
          await trainer.request.get(origin + '/api/measurements/sync?' + scope)
        ).status(),
      ).toBe(403);
    } finally {
      await browser?.close();
      if (server && server.exitCode === null) {
        server.kill('SIGTERM');
        await new Promise<void>((resolve) =>
          server!.once('exit', () => resolve()),
        );
      }
      await Promise.all(
        [tokenPath, controlPath, statePath].map((path) =>
          unlink(path).catch(() => {}),
        ),
      );
    }
  },
  120000,
);
