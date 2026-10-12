import 'server-only';
import { z } from 'zod';
import { transformMateMessages } from '@/server/transformmate/messages';
import { authorize } from '@/server/auth/guards';
import { getTransformMateConnectionFence } from '@/server/transformmate/runtime';
import {
  cachedCatalog,
  catalogMatches,
  rememberExerciseAliases,
} from '@/server/transformmate/catalog-cache';
import { TransformMateApiError } from '@/server/transformmate/errors';
import { canPlanExercise } from '@/server/transformmate/catalog-schema';
import {
  transformMateCatalogItemSchema,
  transformMateExerciseInfoSchema,
} from '@/contracts/transformmate';
import { selectMediaUrl } from '@/server/transformmate/catalog-schema';

export class CatalogError extends Error {
  constructor(public readonly status: number) {
    super('TransformMate catalog unavailable');
  }
}
export async function requireCatalogAccess(headers: Headers, ownerId: string) {
  const access = await authorize(headers, 'workouts:read', ownerId);
  if (!access.ok) throw new CatalogError(access.status);
}
export function exerciseId(value: string) {
  return z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .parse(value);
}
export async function listExercises(
  headers: Headers,
  ownerId: string,
  query: string,
) {
  await requireCatalogAccess(headers, ownerId);
  const q = z.string().max(200).parse(query).trim().toLocaleLowerCase('ru');
  const fence = await getTransformMateConnectionFence(ownerId);
  if (!fence) throw new CatalogError(503);
  const scope = {
    ownerId,
    generation: fence.generation,
    locale: 'ru' as const,
    client: fence.client,
  };
  await requireCatalogAccess(headers, ownerId);
  await fence.assertCurrent();
  const result = await cachedCatalog(scope);
  await fence.assertCurrent();
  await requireCatalogAccess(headers, ownerId);
  return result
    .filter((e) => catalogMatches(scope, e.id, e.name, q))
    .slice(0, 50)
    .map((e) =>
      transformMateCatalogItemSchema.parse({
        id: e.id,
        name: e.name,
        canPlan: canPlanExercise(e),
      }),
    );
}
export async function getExercise(
  headers: Headers,
  ownerId: string,
  id: number,
) {
  await requireCatalogAccess(headers, ownerId);
  const fence = await getTransformMateConnectionFence(ownerId);
  if (!fence) throw new CatalogError(503);
  await requireCatalogAccess(headers, ownerId);
  const result = await fence.client.getExercise(id);
  await fence.assertCurrent();
  await requireCatalogAccess(headers, ownerId);
  if (result.body.id !== id) throw new CatalogError(502);
  rememberExerciseAliases(
    {
      ownerId,
      generation: fence.generation,
      locale: 'ru',
      client: fence.client,
    },
    result.body,
  );
  return result.body;
}
export async function exerciseInfo(
  headers: Headers,
  ownerId: string,
  id: number,
) {
  const e = await getExercise(headers, ownerId, id);
  return transformMateExerciseInfoSchema.parse({
    id: e.id,
    name: e.name,
    description: e.description,
    canPlan: canPlanExercise(e),
    hasVideo: selectMediaUrl(e) !== null,
  });
}
export async function catalogResponse(operation: () => Promise<unknown>) {
  try {
    return Response.json(
      { contractVersion: 1, source: 'user', data: await operation() },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: transformMateMessages.unavailable },
      {
        status:
          error instanceof CatalogError
            ? error.status
            : error instanceof TransformMateApiError && error.status === 429
              ? 429
              : error instanceof z.ZodError
                ? 400
                : 502,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
