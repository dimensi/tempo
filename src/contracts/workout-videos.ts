import { z } from 'zod';
export const VIDEO_PART_BYTES = 4 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 256 * 1024 * 1024;
export const VIDEO_INPUT_MAX_BYTES = 1024 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 300;
export const videoCreateSchema = z
  .object({
    sessionId: z.uuid(),
    exerciseId: z.uuid(),
    size: z.number().int().positive().max(VIDEO_INPUT_MAX_BYTES),
    name: z.string().trim().min(1).max(240),
    lastModified: z.number().int().positive().max(8.64e15).optional(),
  })
  .strict();
export interface WorkoutVideo {
  id: string;
  sessionId: string;
  exerciseId: string;
  size: number;
  duration: number;
  state: 'uploading' | 'processing' | 'ready' | 'failed';
  parts: number[];
  name: string;
  recordedAt: number | null;
  createdAt: number;
  playbackSize: number | null;
  progress: number;
  error: 'invalid' | 'processing' | null;
}
