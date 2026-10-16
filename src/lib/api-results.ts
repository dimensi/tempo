import { syncStatusSchema } from '@/contracts/nutrition-sync';
import { transformMateReadSchema } from '@/contracts/read-resources';
import { stepsGoalSchema } from '@/contracts/steps-goal';
import {
  acceptInviteErrorSchema,
  acceptInviteResponseSchema,
} from '@/contracts/trainers';
import {
  transformMateCatalogResultSchema,
  transformMateExerciseInfoSchema,
  transformMateMuscleDictionarySchema,
} from '@/contracts/transformmate';
import { transformMateConnectionStatusSchema } from '@/contracts/transformmate-connection';
import { workoutPlanSchema, workoutSessionSchema } from '@/contracts/workouts';
import { measurementPrecisionIssueSchema } from '@/contracts/yazio-body';
import { z } from 'zod';
/** Response decoders belong to the transport layer; input validation stays with forms. */
export const apiResults = {
  stepsGoal: (value: unknown) => stepsGoalSchema.parse(value),
  dayRefresh: (value: unknown) => syncStatusSchema.parse(value),
  measurementIssues: (value: unknown) =>
    z.array(measurementPrecisionIssueSchema).parse(value),
  exercise: (value: unknown) => transformMateExerciseInfoSchema.parse(value),
  muscles: (value: unknown) => transformMateMuscleDictionarySchema.parse(value),
  catalog: (value: unknown) => transformMateCatalogResultSchema.parse(value),
  transformMate: (value: unknown) =>
    transformMateReadSchema.shape.data.parse(value),
  plan: (value: unknown) => workoutPlanSchema.parse(value),
  session: (value: unknown) => workoutSessionSchema.parse(value),
  connection: (value: unknown) =>
    transformMateConnectionStatusSchema.parse(value),
  invite: (value: unknown) => acceptInviteResponseSchema.safeParse(value),
  inviteError: (value: unknown) => acceptInviteErrorSchema.safeParse(value),
  connectionError: (value: unknown) =>
    transformMateConnectionStatusSchema.shape.errorCode.safeParse(value),
};
