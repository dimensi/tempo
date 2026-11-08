import { z } from 'zod';
import { videoCreateSchema } from './workout-videos';

export const techniqueDescriptionMax = 20000;
export const techniqueScopeSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const techniqueSummarySchema = z.object({
  scope: techniqueScopeSchema,
  videoId: z.uuid().nullable(),
});

export const techniqueDescriptionInput = z.strictObject({
  scope: techniqueScopeSchema,
  revision: z.number().int().nonnegative(),
  description: z.string().trim().max(techniqueDescriptionMax),
});
export const techniqueVideoInput = videoCreateSchema
  .pick({ name: true, size: true, lastModified: true })
  .extend({ scope: techniqueScopeSchema });

export const techniqueEditorSchema = z.object({
  scope: techniqueScopeSchema,
  revision: z.number().int().nonnegative(),
  description: z.string(),
  videoId: z.uuid().nullable(),
  candidate: z
    .object({
      id: z.uuid(),
      name: z.string(),
      size: z.number(),
      lastModified: z.number().nullable(),
      parts: z.array(z.number()),
      state: z.enum(['uploading', 'processing', 'failed']),
      progress: z.number(),
      error: z.enum(['invalid', 'processing']).nullable(),
    })
    .nullable(),
});
export type TechniqueEditorData = z.infer<typeof techniqueEditorSchema>;
