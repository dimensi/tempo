import { z } from 'zod';
import { nutritionTotalsSchema } from './nutrition';
import { measurementValueSchema } from './measurements';
import { weightHistorySchema } from './health';
import { stepsGoalSchema } from './steps-goal';

const date = z.iso.date();
const stamp = z.iso.datetime();
export const offlineSummaryDaySchema = z.strictObject({
  date,
  fetchedAt: stamp,
  totals: nutritionTotalsSchema,
  knownTotals: nutritionTotalsSchema,
  hasEntries: z.boolean(),
});
export const offlineViewsSchema = z.strictObject({
  // Compact observations only; no meals, notes, attachments or upstream URLs.
  summary: z
    .strictObject({
      dailyStepsGoal: stepsGoalSchema.shape.dailyStepsGoal,
      from: date,
      to: date,
      workouts: z.strictObject({
        planned: z
          .strictObject({ title: z.string().max(500), date })
          .nullable(),
        completed: z
          .strictObject({ title: z.string().max(500), date })
          .nullable(),
      }),
      latestWeight: z
        .strictObject({ date, value: z.string().max(100) })
        .nullable(),
      nutrition: z.array(offlineSummaryDaySchema).max(366),
      body: z
        .array(
          z.strictObject({
            id: z.string().max(100),
            measuredAt: date,
            values: z.array(measurementValueSchema).max(7),
          }),
        )
        .max(1000),
      bodyComplete: z.boolean(),
      weight: weightHistorySchema,
      steps: z
        .array(
          z.strictObject({
            date,
            steps: z.number().int().nonnegative().nullable(),
            observedAt: stamp,
          }),
        )
        .max(366),
    })
    .nullable(),
  settings: z
    .strictObject({
      yazioConnected: z.boolean(),
      transformMateConnected: z.boolean(),
      initialFrom: date.nullable(),
      timezone: z.string().max(100),
      automaticSync: z.boolean(),
      lastSuccess: stamp.nullable(),
    })
    .nullable(),
  comments: z
    .array(
      z.strictObject({
        key: z.string().max(100),
        target: z.string().max(600),
        date,
        parentKey: z.string().max(100).nullable(),
        authorName: z.string().max(300),
        body: z.string().max(4000),
        createdAt: stamp,
      }),
    )
    .max(500),
  commentsComplete: z.boolean(),
  catalog: z
    .array(
      z.strictObject({
        id: z.number().int().positive(),
        name: z.string().max(500),
        description: z.string().max(20000).nullable(),
        muscleGroups: z.array(z.string().max(500)).max(100),
        fetchedAt: stamp,
        hasVideo: z.boolean(),
      }),
    )
    .max(200),
  catalogComplete: z.boolean(),
  videos: z
    .array(
      z.strictObject({
        id: z.string().max(100),
        sessionHref: z.string().max(600),
        size: z
          .number()
          .int()
          .positive()
          .max(256 * 1024 * 1024),
        href: z
          .string()
          .regex(
            /^\/api\/workouts\/videos\/[A-Za-z0-9-]+\/playback\?ownerId=[^&#?]+$/,
          ),
      }),
    )
    .max(100),
});
export type OfflineViews = z.infer<typeof offlineViewsSchema>;
