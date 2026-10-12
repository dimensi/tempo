import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { getSessionWith429Retry } from './auth-session';

test('synthetic invite UI accepts eight plain characters and explains unavailable/account/server failures without losing input', async ({
  page,
  browser,
  baseURL,
}) => {
  const origin = baseURL!;
  const signIn = async (
    request: typeof page.request,
    email: string,
    password: string,
  ) => {
    const submit = () =>
      request.post('/api/auth/sign-in/email', {
        headers: { origin },
        data: { email, password },
      });
    let response = await submit();
    if (response.status() === 429) {
      const seconds = Number(
        response.headers()['x-retry-after'] ??
          response.headers()['retry-after'],
      );
      expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 60).toBe(
        true,
      );
      test.setTimeout(test.info().timeout + (seconds + 1) * 1000);
      await page.waitForTimeout(seconds * 1000);
      await page.waitForTimeout(1000);
      response = await submit();
    }
    expect(response.status()).toBe(200);
  };
  await signIn(page.request, 'owner@example.test', 'Test-only-password-12345');
  const ownerId = (await getSessionWith429Retry(page.request)).user.id;
  const email = `invite-${randomUUID()}@example.test`;
  const tokens: string[] = [];
  const create = async () => {
    const response = await page.request.post('/api/trainers/invitations', {
      headers: { origin },
      data: { ownerId, email },
    });
    expect(response.status()).toBe(200);
    const token = (await response.json()).token as string;
    tokens.push(token);
    return token;
  };
  const context = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
  });
  const guest = await context.newPage();
  const db = new Database('.data/e2e.sqlite', { fileMustExist: true });
  const fill = async () => {
    await guest
      .getByRole('textbox', { name: 'Имя', exact: true })
      .fill('Synthetic trainer');
    await guest.getByLabel('Пароль (от 8 символов)').fill('abcdefgh');
  };
  const button = () =>
    guest.getByRole('button', { name: 'Принять приглашение', exact: true });
  try {
    let posts = 0;
    guest.on('request', (request) => {
      if (
        request.url().endsWith('/api/trainers/invitations/accept') &&
        request.method() === 'POST'
      )
        posts++;
    });
    await guest.goto('/invite');
    await fill();
    await button().click();
    await expect(
      guest.getByRole('alert').filter({
        hasText:
          /Ссылка приглашения|Аккаунт создан|уже есть аккаунт|Не удалось принять приглашение/,
      }),
    ).toContainText('Ссылка приглашения недействительна');
    expect(posts).toBe(0);
    const token = await create();
    await guest.goto(`/invite#${token}`);
    await fill();
    await guest.getByLabel('Пароль (от 8 символов)').fill('abcdefg');
    await button().click();
    await expect(
      guest.getByText('Введите пароль от 8 до 128 символов.', { exact: true }),
    ).toBeVisible();
    expect(posts).toBe(0);
    await guest.getByLabel('Пароль (от 8 символов)').fill('abcdefgh');
    await button().click();
    await expect(
      guest.getByRole('alert').filter({
        hasText:
          /Ссылка приглашения|Аккаунт создан|уже есть аккаунт|Не удалось принять приглашение/,
      }),
    ).toContainText('Аккаунт создан.');
    expect(new URL(guest.url()).hash).toBe('');
    await signIn(guest.request, email, 'abcdefgh');
    expect((await getSessionWith429Retry(guest.request)).user.role).toBe(
      'TRAINER',
    );
    await guest.goto(`/invite#${token}`);
    await guest.reload();
    await fill();
    await button().click();
    await expect(
      guest.getByRole('alert').filter({
        hasText:
          /Ссылка приглашения|Аккаунт создан|уже есть аккаунт|Не удалось принять приглашение/,
      }),
    ).toContainText('уже использована');
    await expect(
      guest
        .getByRole('alert')
        .getByRole('link', { name: 'Войти', exact: true }),
    ).toHaveAttribute('href', '/login');
    await expect(guest.getByLabel('Пароль (от 8 символов)')).toHaveValue(
      'abcdefgh',
    );
    expect(new URL(guest.url()).hash).toBe('#' + token);
    const duplicate = await create();
    await guest.goto(`/invite#${duplicate}`);
    await fill();
    await button().click();
    await expect(
      guest.getByRole('alert').filter({
        hasText:
          /Ссылка приглашения|Аккаунт создан|уже есть аккаунт|Не удалось принять приглашение/,
      }),
    ).toContainText('уже есть аккаунт');
    await guest.route('**/api/trainers/invitations/accept', (route) =>
      route.fulfill({
        status: 500,
        json: { error: 'SYNTHETIC_PRIVATE_FAILURE' },
      }),
    );
    await button().click();
    await expect(
      guest.getByRole('alert').filter({
        hasText:
          /Ссылка приглашения|Аккаунт создан|уже есть аккаунт|Не удалось принять приглашение/,
      }),
    ).toContainText('Попробуйте ещё раз позже');
    await expect(
      guest.getByRole('textbox', { name: 'Имя', exact: true }),
    ).toHaveValue('Synthetic trainer');
    await expect(guest.getByLabel('Пароль (от 8 символов)')).toHaveValue(
      'abcdefgh',
    );
    await expect(
      guest.getByText('SYNTHETIC_PRIVATE_FAILURE', { exact: false }),
    ).toHaveCount(0);
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    for (const token of tokens)
      db.prepare(
        'DELETE FROM trainer_invitations WHERE owner_id=? AND token_hash=?',
      ).run(ownerId, createHash('sha256').update(token).digest('hex'));
    db.prepare('DELETE FROM user WHERE email=?').run(email);
    db.close();
    await context.close().catch(() => undefined);
  }
});
