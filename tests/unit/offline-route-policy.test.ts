import { expect, it } from 'vitest';
import {
  offlineWorkoutHrefSchema,
  offlineSnapshotSchema,
} from '@/contracts/offline';
import { offlineFixture } from '../offline/fixtures';
it('accepts canonical readonly workout links and rejects APIs, arbitrary paths and media', () => {
  for (const href of [
    '/workouts/native/12',
    '/workouts/sessions/local-session',
    '/workouts/plans/plan/workouts/workout',
    '/workouts/links/link',
  ])
    expect(offlineWorkoutHrefSchema.safeParse(href).success).toBe(true);
  for (const href of [
    'https://external.test/workouts/native/12',
    '/api/auth/session',
    '/workouts/native/0',
    '/workouts/native/12?token=secret',
    '/workouts/plans/plan/edit',
    '/workouts/native/12/video',
    '/workouts/../settings',
  ])
    expect(offlineWorkoutHrefSchema.safeParse(href).success).toBe(false);
});
it('old route-less snapshots fail closed and extra private identifiers cannot enter the strict DTO', () => {
  const snapshot = offlineFixture(Date.now());
  const old = structuredClone(snapshot);
  delete (old as Partial<typeof old>).workoutDates;
  expect(offlineSnapshotSchema.safeParse(old).success).toBe(false);
  expect(
    offlineSnapshotSchema.safeParse({
      ...snapshot,
      rawResponse: '<private HTML>',
    }).success,
  ).toBe(false);
  expect(
    offlineSnapshotSchema.safeParse({
      ...snapshot,
      nativeTrainings: [
        { ...snapshot.nativeTrainings[0], remoteTrainingId: 12 },
      ],
    }).success,
  ).toBe(false);
});
