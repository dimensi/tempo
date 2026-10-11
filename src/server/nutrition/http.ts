import 'server-only';
import { z } from 'zod';
import { readServerEnv } from '@/server/env';
import { NutritionAccessError } from './access';
import { NutritionSyncBusyError } from '@/server/jobs/nutrition-sync';
import { nutritionSyncMessages as messages } from '@/contracts/nutrition-sync';

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin !== new URL(readServerEnv().BETTER_AUTH_URL).origin)
    throw new NutritionAccessError(403);
}
export async function readBody(request: Request, limit: number) {
  if (!request.body) throw new Error('Missing body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new z.ZodError([]);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function respond(operation: () => Promise<Response>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof NutritionAccessError)
      return json({ error: messages.forbidden }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: messages.invalid }, 400);
    if (error instanceof NutritionSyncBusyError)
      return json({ error: messages.failure }, 409);
    return json({ error: messages.failure }, 502);
  }
}
