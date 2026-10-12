import { expect, type APIRequestContext } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

const sessionSchema = z.object({ user: z.object({ id: z.string().min(1) }) });
const MAX_WAIT_MS = 90000;
const MAX_ATTEMPTS = 3;

// Real auth remains enabled. Retry only an explicit session-endpoint throttle;
// assert HTTP success before reading the authenticated user shape.
export async function getSessionWith429Retry(request: APIRequestContext) {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await request.get('/api/auth/get-session', {
      timeout: Math.min(30000, Math.max(1, deadline - Date.now())),
    });
    if (response.status() === 429 && attempt < MAX_ATTEMPTS) {
      const headers = response.headers();
      const retryAfter = headers['retry-after'] ?? headers['x-retry-after'];
      expect(
        retryAfter,
        'GET session 429 must supply Retry-After',
      ).toBeDefined();
      const milliseconds = /^\d+$/.test(retryAfter!)
        ? Number(retryAfter) * 1000
        : Math.max(0, Date.parse(retryAfter!) - Date.now());
      expect(
        Number.isFinite(milliseconds),
        'GET session Retry-After must be valid',
      ).toBe(true);
      const wait = milliseconds + 1000;
      expect(
        wait,
        'GET session retry must fit the bounded 90s budget',
      ).toBeLessThanOrEqual(deadline - Date.now());
      await response.dispose();
      await delay(wait);
      continue;
    }
    expect(
      response.status(),
      'GET /api/auth/get-session must return HTTP 200',
    ).toBe(200);
    return sessionSchema.parse(await response.json());
  }
  throw new Error('GET session retry budget exhausted');
}
