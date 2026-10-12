import { expect, test, type APIRequestContext } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

const sessionSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    role: z.enum(['OWNER', 'TRAINER']),
    email: z.email(),
  }),
});
const MAX_WAIT_MS = 90000;
interface SessionOptions {
  url?: string;
  onStatus?: (status: number) => void;
}

// Real auth remains enabled. A single explicit throttle is the only retryable
// response; denial and server errors fail before any authenticated shape is used.
async function sessionResponse(
  request: APIRequestContext,
  options: SessionOptions,
) {
  const deadline = Date.now() + MAX_WAIT_MS;
  const read = async () => {
    const response = await request.get(options.url ?? '/api/auth/get-session', {
      timeout: Math.min(30000, Math.max(1, deadline - Date.now())),
    });
    options.onStatus?.(response.status());
    return response;
  };
  let response = await read();
  if (response.status() === 429) {
    const headers = response.headers();
    const retryAfter = headers['x-retry-after'] ?? headers['retry-after'];
    expect(
      retryAfter,
      'GET session 429 must supply a numeric Retry-After',
    ).toMatch(/^\d+(?:\.\d+)?$/);
    const seconds = Number(retryAfter);
    expect(
      Number.isFinite(seconds) && seconds >= 0 && seconds <= 60,
      'GET session 429 must supply a finite nonnegative Retry-After of at most 60 seconds',
    ).toBe(true);
    const wait = (seconds + 1) * 1000;
    expect(
      wait,
      'GET session retry must fit the bounded 90s budget',
    ).toBeLessThanOrEqual(deadline - Date.now());
    // Extend only by the actual server-directed delay, preserving the assertion budget.
    test.setTimeout(test.info().timeout + wait);
    await response.dispose();
    await delay(seconds * 1000);
    await delay(1000);
    response = await read();
  }
  expect(
    response.status(),
    'GET /api/auth/get-session must return HTTP 200',
  ).toBe(200);
  return response;
}
export async function getSessionWith429Retry(
  request: APIRequestContext,
  options: SessionOptions = {},
) {
  return sessionSchema.parse(
    await (await sessionResponse(request, options)).json(),
  );
}
export async function getSignedOutSessionWith429Retry(
  request: APIRequestContext,
) {
  return z.null().parse(await (await sessionResponse(request, {})).json());
}
