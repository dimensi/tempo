import { z } from 'zod';
export const VIDEO_PART_BYTES = 4 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 256 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 300;
export const videoCreateSchema = z
  .object({
    sessionId: z.uuid(),
    exerciseId: z.uuid(),
    size: z.number().int().positive().max(VIDEO_MAX_BYTES),
    duration: z.number().positive().max(VIDEO_MAX_SECONDS),
  })
  .strict();
export interface WorkoutVideo {
  id: string;
  sessionId: string;
  exerciseId: string;
  size: number;
  duration: number;
  state: 'uploading' | 'ready';
  parts: number[];
}
