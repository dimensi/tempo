import 'server-only';
import type { TransformMateClient } from '@/server/transformmate/client';
import { TransformMateApiError } from '@/server/transformmate/errors';
import type { SyncRepository } from './repository';
import type { SyncLink } from './state';

export class WorkoutDeletionError extends Error {
  constructor(public status = 502) {
    super('Linked workout deletion was not confirmed');
  }
}
type Connection = {
  client: Pick<
    TransformMateClient,
    'getTraining' | 'listTrainings' | 'deleteTrainingOnce'
  >;
  accountScope: string;
  authorId: number;
  assertCurrent(): Promise<void>;
};

/** Caller holds the owner queue. Retain local data until a guarded GET confirms absence. */
export async function deleteLinkedTraining(
  original: SyncLink,
  context: {
    repository: SyncRepository;
    connection(): Promise<Connection | null>;
    guard(): Promise<void>;
  },
) {
  let link = original;
  await context.guard();
  if (link.remoteTrainingId === null && !link.state.attempted)
    return { link, accountScope: null };
  const connection = await context.connection();
  if (!connection) throw new WorkoutDeletionError();
  const guard = async () => {
    await context.guard();
    await connection.assertCurrent();
    await context.guard();
  };
  await guard();
  if (
    (link.state.deletionAccountScope &&
      link.state.deletionAccountScope !== connection.accountScope) ||
    (link.state.published &&
      link.state.published.authorId !== connection.authorId)
  )
    throw new WorkoutDeletionError(409);
  if (link.remoteTrainingId === null) {
    const response = await connection.client.listTrainings();
    await guard();
    const matches = response.body.filter(
      (item) => item.description === link.state.marker,
    );
    // An ambiguous create may still exist: an empty listing is not deletion confirmation.
    if (matches.length !== 1) throw new WorkoutDeletionError(409);
    const saved = context.repository.cas(link, link.state, matches[0]!.id);
    if (!saved) throw new WorkoutDeletionError(409);
    link = saved;
  }
  const id = link.remoteTrainingId!;
  const read = async () => {
    await guard();
    try {
      const response = await connection.client.getTraining(id);
      await guard();
      return response.body;
    } catch (error) {
      await guard();
      if (error instanceof TransformMateApiError && error.status === 404)
        return null;
      throw error;
    }
  };
  const current = await read();
  if (!current) {
    // Covers restart/retry after a committed DELETE whose response was lost.
    if (
      link.state.deletionAccountScope !== connection.accountScope &&
      link.state.published?.authorId !== connection.authorId
    )
      throw new WorkoutDeletionError(409);
    return { link, accountScope: connection.accountScope };
  }
  if (
    current.id !== id ||
    !current.is_mine ||
    current.author !== connection.authorId ||
    current.description !== link.state.marker
  )
    throw new WorkoutDeletionError(409);
  await guard();
  const claimed = context.repository.cas(link, {
    ...link.state,
    deletionAccountScope: connection.accountScope,
  });
  if (!claimed) throw new WorkoutDeletionError(409);
  link = claimed;
  try {
    // One explicit attempt, no token-refresh replay. The callback runs after token acquisition.
    await connection.client.deleteTrainingOnce(id, guard);
  } catch {
    // Only the following guarded read can settle an ambiguous response.
  }
  if (await read()) throw new WorkoutDeletionError();
  await guard();
  return { link, accountScope: connection.accountScope };
}
