import 'server-only';
import { createHash } from 'node:crypto';
import { transformMatePublicationCapability } from '@/contracts/transformmate-capability';
import type { Workout } from '@/contracts/workouts';
import type { TransformMateClient } from '@/server/transformmate/client';
import type { SyncLink, SyncState } from './state';

export function bindCustomExercises(workout: Workout, link: SyncLink): Workout {
  return {
    ...workout,
    exercises: workout.exercises.map((exercise) => {
      if (exercise.transformMate) return exercise;
      const binding = link.state.customExercises?.find(
        (item) =>
          item.key === exercise.id &&
          item.name === exercise.name &&
          item.phase === 'verified',
      );
      return binding?.remoteId
        ? {
            ...exercise,
            transformMate: {
              exerciseId: binding.remoteId,
              occurrenceKey: binding.key,
            },
          }
        : exercise;
    }),
  };
}

/** Claim before POST; recover only by account-scoped provenance, never by name alone. */
export async function resolveCustomExercises(options: {
  workout: Workout;
  link: SyncLink;
  accountScope: string;
  authorId: number;
  claims: NonNullable<SyncState['customExercises']>;
  client: Pick<
    TransformMateClient,
    'listExercises' | 'getExercise' | 'createCustomExercise'
  >;
  guard(): Promise<void>;
  save(link: SyncLink, patch: Partial<SyncState>): Promise<SyncLink | null>;
}) {
  let link = options.link;
  for (const exercise of options.workout.exercises) {
    if (exercise.transformMate) continue;
    if (!exercise.id) throw new Error('Missing persisted exercise identity');
    const digest = createHash('sha256')
      .update(
        JSON.stringify([link.ownerId, options.accountScope, exercise.name]),
      )
      .digest('hex');
    const marker = `[tempo-exercise:${digest}]`;
    const previous = link.state.customExercises?.find(
      (item) => item.key === exercise.id,
    );
    if (previous && previous.accountScope !== options.accountScope)
      throw new Error('Custom exercise account changed');
    if (previous?.phase === 'verified' && previous.name === exercise.name)
      continue;
    const recover = async () => {
      await options.guard();
      const { body: summaries } = await options.client.listExercises({
        search: exercise.name,
      });
      await options.guard();
      const candidates = summaries.filter(
        (item) => item.name === exercise.name,
      );
      if (candidates.length > 50) throw new Error('Ambiguous custom exercise');
      const matches: number[] = [];
      const exact: number[] = [];
      for (const summary of candidates) {
        const { body } = await options.client.getExercise(summary.id);
        await options.guard();
        if (
          body.author === options.authorId &&
          body.description === marker &&
          body.exercise_type?.id === 4
        )
          matches.push(body.id);
        if (
          transformMatePublicationCapability(body.metrics).state ===
            'supported' ||
          (body.author === options.authorId &&
            body.exercise_type?.id === 4 &&
            body.metrics.length === 0)
        )
          exact.push(body.id);
      }
      if (matches.length > 1) throw new Error('Ambiguous custom exercise');
      return {
        owned: matches[0],
        exact: exact.length === 1 ? exact[0] : undefined,
      };
    };
    const claims = [
      ...options.claims,
      ...(link.state.customExercises ?? []),
    ].filter(
      (item) =>
        item.marker === marker && item.accountScope === options.accountScope,
    );
    const known = claims.find(
      (item) => item.phase === 'verified' && item.remoteId,
    );
    const found = known?.remoteId
      ? { owned: known.remoteId, exact: undefined }
      : await recover();
    const pending = claims.some((item) => item.phase === 'unknown');
    let remoteId = found.owned ?? (pending ? undefined : found.exact);
    if (!remoteId) {
      if (claims.some((item) => item.phase === 'unknown')) {
        const waiting = await options.save(link, {
          status: 'unknown',
          reason: 'ambiguous_write',
        });
        return { link: waiting ?? link, ready: false };
      }
      const claim = {
        key: exercise.id,
        name: exercise.name,
        marker,
        accountScope: options.accountScope,
        phase: 'unknown' as const,
        remoteId: null,
      };
      const claimed = await options.save(link, {
        status: 'unknown',
        reason: 'ambiguous_write',
        customExercises: [
          ...(link.state.customExercises ?? []).filter(
            (item) => item.key !== exercise.id,
          ),
          claim,
        ],
      });
      if (!claimed) return { link, ready: false };
      link = claimed;
      try {
        await options.guard();
        const response = await options.client.createCustomExercise(
          {
            name: exercise.name,
            description: marker,
            youtube_link: '',
            vimeo_link: '',
            muscles: [],
            equipments: [],
            sports: [],
            time_zone: 'UTC',
            exercise_type: 'Пользовательский',
          },
          options.guard,
        );
        await options.guard();
        const { body } = await options.client.getExercise(response.body.id);
        await options.guard();
        if (
          body.author !== options.authorId ||
          body.description !== marker ||
          body.name !== exercise.name ||
          body.exercise_type?.id !== 4
        )
          throw new Error('Custom exercise identity changed');
        remoteId = body.id;
      } catch {
        await options.guard();
        remoteId = (await recover()).owned;
        if (!remoteId) return { link, ready: false };
      }
    }
    const next = await options.save(link, {
      status: 'pending',
      reason: null,
      customExercises: [
        ...(link.state.customExercises ?? []).filter(
          (item) => item.key !== exercise.id,
        ),
        {
          key: exercise.id,
          name: exercise.name,
          marker,
          accountScope: options.accountScope,
          phase: 'verified',
          remoteId,
        },
      ],
    });
    if (!next) return { link, ready: false };
    link = next;
  }
  return { link, ready: true };
}
