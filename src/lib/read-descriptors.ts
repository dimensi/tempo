import {
  anamnesisMarkerSummarySchema,
  anamnesisOverviewSchema,
  medicalDocumentSchema,
  medicalMarkerSchema,
  medicalObservationSchema,
} from '@/contracts/anamnesis';
import { stepsSummarySchema, weightHistorySchema } from '@/contracts/health';
import { measurementSchema } from '@/contracts/measurements';
import {
  nutritionDaySchema,
  safeMealPhotoViewSchema,
} from '@/contracts/nutrition';
import { analyticsDataSchema } from '@/contracts/read-analytics';
import { readContextSchema } from '@/contracts/read-context';
import {
  commentsReadSchema,
  overviewReadSchema,
  transformMateReadSchema,
  workoutsReadSchema,
} from '@/contracts/read-resources';
import { readSettingsSchema } from '@/contracts/read-settings';
import { workoutDetailSchema } from '@/contracts/read-workout';
import { transformMateCatalogResultSchema } from '@/contracts/transformmate';
import { z } from 'zod';
import { reconcileRead } from './reconcile-read';
export interface ReadDescriptor<T> {
  href: string | undefined;
  decode: (body: string, previous?: T) => T;
}
function definition<S extends z.ZodType, T = z.output<S>>(
  schema: S,
  select?: (value: z.output<S>) => T,
) {
  return (href: string | undefined): ReadDescriptor<T> => ({
    href,
    decode: (body, previous) => {
      const value = schema.parse(JSON.parse(body));
      return reconcileRead(previous, select ? select(value) : (value as T));
    },
  });
}
export const readResources = {
  diary: definition(z.array(nutritionDaySchema)),
  photos: definition(z.array(safeMealPhotoViewSchema)),
  weight: definition(weightHistorySchema),
  steps: definition(stepsSummarySchema),
  measurements: definition(z.array(measurementSchema)),
  analytics: definition(analyticsDataSchema),
  settings: definition(readSettingsSchema),
  workout: definition(workoutDetailSchema),
  context: definition(readContextSchema),
  overview: definition(overviewReadSchema),
  workouts: definition(workoutsReadSchema, (value) => ({
    contractVersion: 1 as const,
    source: 'user' as const,
    ...value.data,
  })),
  transformMate: definition(transformMateReadSchema, (value) => value.data),
  catalog: definition(transformMateCatalogResultSchema),
  comments: definition(commentsReadSchema),
  anamnesis: definition(anamnesisOverviewSchema),
  markers: definition(z.array(anamnesisMarkerSummarySchema)),
  marker: definition(medicalMarkerSchema),
  observations: definition(z.array(medicalObservationSchema)),
  documents: definition(z.array(medicalDocumentSchema)),
  document: definition(medicalDocumentSchema),
};
