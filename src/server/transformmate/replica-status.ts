import 'server-only';
import { transformMateOwner } from './connection';
import { getTransformMateCatalogBindingFence } from './runtime';
import { replicaStore } from './replica-store';
import { transformMateReplicaStatusSchema } from '@/contracts/transformmate-replica';
export async function getReplicaStatus(headers: Headers) {
  const ownerId = await transformMateOwner(headers);
  const binding = await getTransformMateCatalogBindingFence(ownerId);
  const result = binding.accountScope
    ? replicaStore().status(
        { ownerId, accountScope: binding.accountScope, locale: 'ru' },
        Date.now(),
      )
    : null;
  await binding.assertCurrent();
  binding.assertBindingCurrent();
  if ((await transformMateOwner(headers)) !== ownerId)
    throw new Error('Owner changed');
  const state = result?.state;
  const at =
    result?.nextAt === null || !result
      ? null
      : Math.max(
          result.nextAt,
          state?.blocked_until ?? 0,
          state?.next_request_at ?? 0,
          Date.now(),
        );
  return transformMateReplicaStatusSchema.parse({
    total: result?.total ?? 0,
    descriptions: result?.descriptions ?? 0,
    videos: result?.videos ?? 0,
    previews: result?.previews ?? 0,
    bytes: result?.bytes ?? 0,
    pending: result?.pending ?? 0,
    errors: result?.errors ?? 0,
    failedExercises: result?.failedExercises ?? [],
    lastSuccessAt: state?.last_success_at
      ? new Date(state.last_success_at).toISOString()
      : null,
    nextAttemptAt:
      binding.configured && state?.reason !== 'auth' && at !== null
        ? new Date(at).toISOString()
        : null,
    reason: !binding.configured ? 'disconnected' : (state?.reason ?? null),
  });
}
