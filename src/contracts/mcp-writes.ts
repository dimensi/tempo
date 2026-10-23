import { z } from 'zod';
import {
  workoutInputSchema,
  workoutExerciseSchema,
  workoutActionSchema,
  exerciseFeedbackSchema,
  revisionSchema,
} from './workouts';
import { measurementInputSchema } from './measurements';
import { mcpHistoryInput } from './mcp';
const request = { requestId: z.uuid() };
const target = { id: z.uuid(), revision: revisionSchema };
export const mcpCreateWorkout = z.strictObject({
  ...request,
  data: workoutInputSchema.safeExtend({
    status: z.enum(['planned', 'completed']),
  }),
});
export const mcpUpdateWorkout = z.strictObject({
  ...request,
  ...target,
  patch: z.strictObject({
    date: workoutInputSchema.shape.date.optional(),
    title: workoutInputSchema.shape.title.optional(),
    note: workoutInputSchema.shape.note.optional(),
    exercises: z.array(workoutExerciseSchema.partial()).max(50).optional(),
  }),
});
export const mcpTransitionWorkout = z.strictObject({
  ...request,
  ...target,
  action: workoutActionSchema,
});
export const mcpFeedback = z.strictObject({
  ...request,
  ...target,
  feedback: exerciseFeedbackSchema,
});
export const mcpCreateMeasurement = z.strictObject({
  ...request,
  data: measurementInputSchema,
});
export const mcpUpdateMeasurement = z.strictObject({
  ...request,
  id: z.uuid(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  data: measurementInputSchema,
});
export const mcpMeasurements = mcpHistoryInput;
export const mcpSearchExercises = z.strictObject({
  query: z.string().trim().min(1).max(160),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().max(2048).optional(),
});
export const mcpExtraSchemas = {
  get_measurements: mcpMeasurements,
  search_exercises: mcpSearchExercises,
  create_workout: mcpCreateWorkout,
  update_workout: mcpUpdateWorkout,
  transition_workout: mcpTransitionWorkout,
  update_exercise_feedback: mcpFeedback,
  create_measurement: mcpCreateMeasurement,
  update_measurement: mcpUpdateMeasurement,
} as const;
export type McpExtraTool = keyof typeof mcpExtraSchemas;
export type WorkoutCommand =
  | { kind: 'create'; input: z.infer<typeof mcpCreateWorkout> }
  | { kind: 'update'; input: z.infer<typeof mcpUpdateWorkout> }
  | { kind: 'transition'; input: z.infer<typeof mcpTransitionWorkout> }
  | { kind: 'feedback'; input: z.infer<typeof mcpFeedback> };
