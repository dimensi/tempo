import 'server-only';
import {
  enableNutritionSchedule,
  disableNutritionSchedule,
  getNutritionSchedule,
} from '@/server/jobs/nutrition-scheduler';
import { authorize } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import { NutritionAccessError } from '@/server/nutrition/access';
import { nutritionRepository } from '@/server/nutrition/repository';
import { fileTokenStore } from './token-store';
import { tokenSchema } from './client';
import { resolve, sep } from 'node:path';
import {
  yazioTokenImportSchema,
  yazioConfirmationSchema,
  resolveConnectionSchedule,
} from '@/contracts/nutrition-sync';

export async function yazioOwner(headers: Headers) {
  const access = await authorize(headers, 'yazio:manage');
  if (!access.ok) throw new NutritionAccessError(access.status);
  const ownerId = access.session.user.id;
  const scoped = await authorize(headers, 'yazio:manage', ownerId);
  if (!scoped.ok) throw new NutritionAccessError(scoped.status);
  return ownerId;
}
export function configuredStore(ownerId: string) {
  const env = readServerEnv();
  if (!env.YAZIO_TOKEN_FILE) throw new Error('No token file configured');
  const path = resolve(env.YAZIO_TOKEN_FILE);
  const publicDirectory = resolve('public');
  const uploads = resolve(env.UPLOADS_DIR);
  if (
    path === publicDirectory ||
    path.startsWith(publicDirectory + sep) ||
    path === uploads ||
    path.startsWith(uploads + sep)
  )
    throw new Error('Invalid token location');
  return fileTokenStore(path, ownerId, env.BETTER_AUTH_SECRET ?? '');
}
export async function getYazioStatus(headers: Headers) {
  const ownerId = await yazioOwner(headers);
  const pathConfigured = Boolean(readServerEnv().YAZIO_TOKEN_FILE);
  const configured =
    pathConfigured && Boolean(await configuredStore(ownerId).load());
  return {
    configured,
    tokenFileConfigured: pathConfigured,
    sync: nutritionRepository().status(ownerId),
    schedule: getNutritionSchedule(ownerId),
  };
}
export async function saveExistingToken(headers: Headers, input: unknown) {
  const ownerId = await yazioOwner(headers);
  const parsed = yazioTokenImportSchema.parse(input);
  const schedule = resolveConnectionSchedule(parsed);
  const token = tokenSchema.parse(parsed.token);
  const store = configuredStore(ownerId);
  await store.load();
  if ((await yazioOwner(headers)) !== ownerId)
    throw new NutritionAccessError(403);
  await store.save(token);
  enableNutritionSchedule(ownerId, schedule);
}
export async function disconnectYazio(headers: Headers, input: unknown) {
  const ownerId = await yazioOwner(headers);
  yazioConfirmationSchema.parse(input);
  const store = configuredStore(ownerId);
  await store.load();
  if ((await yazioOwner(headers)) !== ownerId)
    throw new NutritionAccessError(403);
  disableNutritionSchedule(ownerId);
  await store.disconnect();
  return { configured: false as const };
}
