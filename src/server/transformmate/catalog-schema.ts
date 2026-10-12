import 'server-only';
import { z } from 'zod';
export const transformMateCatalogSchema = z
  .array(
    z.object({
      id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      name: z.string().max(500),
      metrics: z
        .array(
          z.object({
            id: z.number().int().positive(),
            key: z.string().max(100),
          }),
        )
        .max(50),
    }),
  )
  .max(10000);
export function canPlanExercise(exercise: {
  metrics: { id: number; key: string }[];
}) {
  return (
    exercise.metrics.length === 2 &&
    exercise.metrics.some((m) => m.id === 3 && m.key === 'weight') &&
    exercise.metrics.some((m) => m.id === 4 && m.key === 'reps')
  );
}

export function selectMediaUrl(exercise: {
  kinescope_data: { url: string | null; filetype?: string }[] | null;
}): URL | null {
  for (const media of exercise.kinescope_data ?? []) {
    if (!media.url || (media.filetype && media.filetype !== 'mp4')) continue;
    try {
      const url = new URL(media.url);
      if (
        url.protocol === 'https:' &&
        url.hostname === 'kinescopecdn.net' &&
        !url.port &&
        !url.username &&
        !url.password &&
        !url.hash
      )
        return url;
    } catch {
      /* Invalid upstream media is unavailable. */
    }
  }
  return null;
}
