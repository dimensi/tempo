import 'server-only';
import { getTokenFromCredentials } from '@dimensi/yazio/api';
import {
  yazioCredentialsSchema,
  resolveConnectionSchedule,
} from '@/contracts/nutrition-sync';
import { enableNutritionSchedule } from '@/server/jobs/nutrition-scheduler';
import { NutritionAccessError } from '@/server/nutrition/access';
import { tokenSchema, yazioRequest } from './client';
import { configuredStore, yazioOwner } from './settings';

export class YazioConnectionUnavailableError extends Error {
  constructor() {
    super('YAZIO connection storage is unavailable');
  }
}
export async function connectYazio(headers: Headers, input: unknown) {
  const ownerId = await yazioOwner(headers);
  const credentials = yazioCredentialsSchema.parse(input);
  const schedule = resolveConnectionSchedule(credentials);
  // Resolve storage before sending credentials upstream. No password/email is persisted.
  let store: ReturnType<typeof configuredStore>;
  try {
    store = configuredStore(ownerId);
    await store.load();
  } catch {
    throw new YazioConnectionUnavailableError();
  }
  const token = tokenSchema.parse(
    await yazioRequest(() =>
      getTokenFromCredentials({
        username: credentials.email,
        password: credentials.password,
      }),
    ),
  );
  // Session/role/owner can change while the upstream request is pending.
  if ((await yazioOwner(headers)) !== ownerId)
    throw new NutritionAccessError(403);
  // Retain the loaded generation: disconnect/another connection cancels this save.
  await store.save(token);
  enableNutritionSchedule(ownerId, schedule);
  return { configured: true as const };
}
