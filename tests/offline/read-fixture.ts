import type { WorkoutExercise } from '@/contracts/workouts';
import type { OfflineSnapshot } from '@/contracts/offline';
import { readResponseSchema } from '@/contracts/read-resources';
import { canonicalReadKey } from '@/lib/client-read';
import { OfflineStorage, type CacheFence } from '@/lib/offline-device';
/** Synthetic ordinary response records, rather than a second offline UI fixture. */
export async function seedReadFixture(
  storage: OfflineStorage,
  fence: CacheFence,
  snapshot: OfflineSnapshot,
) {
  const ownerId = 'synthetic-reader-owner';
  const put = async (href: string, data: unknown) => {
    const url = new URL(href, location.origin);
    const schema = readResponseSchema(url.pathname);
    if (!schema) throw Error(`Missing fixture schema: ${href}`);
    const body = JSON.stringify(schema.parse(data));
    await storage.writeResource(fence, {
      version: 2,
      coverage: 'complete',
      key: canonicalReadKey(url),
      body,
      savedAt: Date.parse(snapshot.serverNow),
      touchedAt: Date.parse(snapshot.serverNow),
    });
  };
  await put('/api/read/context', {
    readerId: ownerId,
    ownerId,
    role: snapshot.role,
    partition: snapshot.partition,
    connectionGeneration: snapshot.connectionGeneration,
  });
  const occurrence = (index: number) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
  const exercises = (
    rows: OfflineSnapshot['plannedWorkouts'][number]['exercises'],
  ) =>
    rows.map(({ name, sets, comment }): WorkoutExercise => ({
      name,
      sets,
      ...(comment === undefined ? {} : { comment }),
    }));
  const plans = snapshot.plannedWorkouts.map((row) => ({
    id: row.href.split('/')[3],
    ownerId,
    revision: 1,
    title: row.planTitle,
    description: row.planDescription,
    startsOn: row.date,
    endsOn: row.date,
    createdAt: snapshot.serverNow,
    updatedAt: snapshot.serverNow,
    workouts: [
      {
        id: row.href.split('/')[5],
        date: row.date,
        title: row.title,
        exercises: exercises(row.exercises),
      },
    ],
  }));
  const sessions = snapshot.workoutSessions.map((row) => ({
    id: row.href.split('/').at(-1),
    ownerId,
    revision: 1,
    date: row.date,
    title: row.title,
    exercises: exercises(row.exercises),
    note: row.note,
    status: row.status,
    planId: row.plannedHref?.split('/')[3] ?? null,
    plannedWorkoutId: row.plannedHref?.split('/')[5] ?? null,
    planSnapshot: row.planSnapshot
      ? {
          planTitle: row.planSnapshot.title,
          workout: {
            id: 'fixture-workout',
            date: row.date,
            title: row.planSnapshot.title,
            exercises: exercises(row.planSnapshot.exercises),
          },
        }
      : null,
    createdAt: snapshot.serverNow,
    updatedAt: snapshot.serverNow,
  }));
  for (const plan of plans)
    for (const workout of plan.workouts) {
      const fact = snapshot.transformMateFacts.find(
        (row) =>
          row.plannedHref ===
          `/workouts/plans/${plan.id}/workouts/${workout.id}`,
      );
      if (fact)
        workout.exercises = workout.exercises.map((exercise, index) => ({
          ...exercise,
          name: fact.exercises[index]?.name ?? exercise.name,
          transformMate: {
            exerciseId: index + 1,
            occurrenceKey: occurrence(index),
          },
        }));
    }
  await put(`/api/workouts?ownerId=${ownerId}`, { data: { plans, sessions } });
  const native = snapshot.nativeTrainings.map(({ href, ...row }) => ({
    ...row,
    remoteTrainingId: Number(href.split('/').at(-1)),
    exercises: row.exercises.map((exercise, index) => ({
      ...exercise,
      protocolId: index + 1,
      remoteExerciseId: index + 1,
      exerciseId: index + 1,
      metrics: exercise.metrics.map((group) => ({
        ...group,
        sets: group.sets.map((set) => ({
          ...set,
          metrics: set.metrics.map((metric, index) => ({
            ...metric,
            key: String(index),
          })),
        })),
      })),
    })),
  }));
  const facts = snapshot.transformMateFacts.map((row, index) => {
    const plan =
      plans.find((plan) => row.plannedHref?.includes(`/plans/${plan.id}/`)) ??
      plans[0]!;
    const workout = plan.workouts[0]!;
    const training = native.find(
      (item) => row.nativeHref === `/workouts/native/${item.remoteTrainingId}`,
    );
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      planId: plan.id,
      workoutId: workout.id,
      remoteTrainingId: training?.remoteTrainingId ?? null,
      planSnapshot: { planTitle: plan.title, workout },
      status: 'synced',
      reason: 'remote_fact',
      checkedAt: row.checkedAt,
      actual: {
        date: row.date,
        title: row.title,
        started: row.started,
        finished: row.finished,
        exercises: training
          ? training.exercises.map((exercise, index) => ({
              occurrenceKey: occurrence(index),
              exerciseId: exercise.exerciseId,
              name: exercise.name,
              comment: exercise.comment,
              sets: exercise.metrics
                .filter((group) => group.type === 'fact')
                .flatMap((group) =>
                  group.sets.map((set) => ({
                    ...set,
                    done: set.done ?? false,
                  })),
                ),
            }))
          : row.exercises.map((exercise, index) => ({
              ...exercise,
              occurrenceKey: occurrence(index),
              exerciseId: index + 1,
            })),
      },
    };
  });
  for (const date of snapshot.workoutDates)
    await put(
      `/api/workouts/transformmate?${new URLSearchParams({ ownerId, from: date, to: date, limit: '20' })}`,
      {
        data: {
          configured: true,
          items: facts.filter((row) => row.actual.date === date),
          nativePage: {
            items: native.filter((row) => row.date === date),
            nextCursor: null,
          },
          nativeRefresh: { status: 'idle', checkedAt: null, errorCode: null },
        },
      },
    );
  for (const plan of plans)
    for (const workout of plan.workouts)
      await put(
        `/api/read/workout?${new URLSearchParams({ path: `/workouts/plans/${plan.id}/workouts/${workout.id}`, date: workout.date })}`,
        {
          kind: 'plan',
          plan,
          workout,
          sync:
            facts.find(
              (row) => row.planId === plan.id && row.workoutId === workout.id,
            ) ?? null,
          sessions: sessions.filter((row) => row.planId === plan.id),
        },
      );
  for (const session of sessions)
    await put(
      `/api/read/workout?${new URLSearchParams({ path: `/workouts/sessions/${session.id}`, date: session.date })}`,
      { kind: 'session', session },
    );
  for (const item of native)
    await put(
      `/api/read/workout?${new URLSearchParams({ path: `/workouts/native/${item.remoteTrainingId}`, date: item.date })}`,
      { kind: 'native', item },
    );
  await put(
    `/api/workouts/transformmate/exercises?${new URLSearchParams({ ownerId, offset: '0', limit: '50' })}`,
    {
      contractVersion: 1,
      source: 'user',
      data: snapshot.views.catalog.map((row) => ({
        id: row.id,
        name: row.name,
        canPlan: false,
        publicationCapability: { state: 'unknown', reason: null },
        snippet: row.description,
        preview: { coverage: 'unknown', path: null, revision: 'a'.repeat(64) },
        detailCoverage: 'unknown',
        membershipCoverage: 'unknown',
        muscleGroups: row.muscleGroups.map((name, index) => ({
          id: index + 1,
          name,
        })),
        fetchedAt: row.fetchedAt,
        detailFetchedAt: null,
      })),
      catalog: {
        fetchedAt: snapshot.serverNow,
        stale: false,
        coverage: snapshot.views.catalogComplete ? 'complete' : 'partial',
        refreshState: 'idle',
        total: snapshot.views.catalog.length,
        hasMore: false,
        unknownMembershipCount: 0,
        filters: {
          query: '',
          commonMuscleGroup: null,
          muscleGroups: [],
          offset: 0,
          limit: 50,
        },
      },
    },
  );
  const settings = snapshot.views.settings;
  if (settings)
    await put('/api/read/settings', {
      yazio: {
        configured: settings.yazioConnected,
        tokenFileConfigured: true,
        account: null,
        sync: {
          state: 'idle',
          startedAt: null,
          finishedAt: null,
          completedDates: [],
          skippedDates: [],
          failedDates: [],
          photoFailedDates: [],
        },
        schedule: {
          enabled: true,
          schedulerActive: settings.automaticSync,
          timezone: settings.timezone,
          initialFrom: settings.initialFrom,
          lastSuccess: settings.lastSuccess,
          lastError: null,
          nextRunAt: null,
          attempt: 0,
          running: false,
        },
      },
      transformMate: {
        configured: settings.transformMateConnected,
        account: null,
        checkedAt: null,
        errorCode: null,
      },
      trainers: [],
      stepsGoal: {
        dailyStepsGoal: snapshot.views.summary?.dailyStepsGoal ?? null,
      },
    });
}
