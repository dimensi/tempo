import 'server-only';
import { z } from 'zod';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import {
  workoutPlanInputSchema,
  workoutSessionInputSchema,
  sessionCreateSchema,
  revisionSchema,
} from '@/contracts/workouts';
import { workoutRepository, WorkoutError } from './repository';

export class WorkoutAccessError extends Error {
  constructor(public status: number) {
    super('Workout access denied');
  }
}
const ownerSchema = z.string().min(1).max(128);
async function access(
  headers: Headers,
  ownerId: string,
  permission: Parameters<typeof authorize>[1],
) {
  const result = await authorize(
    headers,
    permission,
    ownerSchema.parse(ownerId),
  );
  if (!result.ok) throw new WorkoutAccessError(result.status);
  return workoutRepository(getDatabase().db);
}
/** Scoped DTO API for reports, analytics and comment target resolution. */
export async function listWorkouts(headers: Headers, ownerId: string) {
  return (await access(headers, ownerId, 'workouts:read')).list(ownerId);
}
export async function createWorkoutPlan(
  headers: Headers,
  ownerId: string,
  input: unknown,
) {
  return (await access(headers, ownerId, 'workouts:plan')).createPlan(
    ownerId,
    workoutPlanInputSchema.parse(input),
  );
}
export async function updateWorkoutPlan(
  headers: Headers,
  ownerId: string,
  id: string,
  revision: unknown,
  input: unknown,
) {
  return (await access(headers, ownerId, 'workouts:plan')).updatePlan(
    ownerId,
    ownerSchema.parse(id),
    revisionSchema.parse(revision),
    workoutPlanInputSchema.parse(input),
  );
}
export async function deleteWorkoutPlan(
  headers: Headers,
  ownerId: string,
  id: string,
  revision: unknown,
) {
  return (await access(headers, ownerId, 'workouts:plan')).deletePlan(
    ownerId,
    ownerSchema.parse(id),
    revisionSchema.parse(revision),
  );
}
export async function createWorkoutSession(
  headers: Headers,
  ownerId: string,
  input: unknown,
) {
  return (await access(headers, ownerId, 'workouts:log')).createSession(
    ownerId,
    sessionCreateSchema.parse(input),
  );
}
export async function updateWorkoutSession(
  headers: Headers,
  ownerId: string,
  id: string,
  revision: unknown,
  input: unknown,
) {
  return (await access(headers, ownerId, 'workouts:log')).updateSession(
    ownerId,
    ownerSchema.parse(id),
    revisionSchema.parse(revision),
    workoutSessionInputSchema.parse(input),
  );
}
export async function deleteWorkoutSession(
  headers: Headers,
  ownerId: string,
  id: string,
  revision: unknown,
) {
  return (await access(headers, ownerId, 'workouts:log')).deleteSession(
    ownerId,
    ownerSchema.parse(id),
    revisionSchema.parse(revision),
  );
}
export { WorkoutError };
