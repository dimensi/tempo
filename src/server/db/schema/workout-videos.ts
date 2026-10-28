import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';
import { workouts } from './workouts';
export const workoutVideos = sqliteTable(
  'workout_videos',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id').notNull(),
    size: integer('size').notNull(),
    duration: integer('duration').notNull(),
    state: text('state', {
      enum: ['uploading', 'processing', 'ready', 'failed'],
    }).notNull(),
    name: text('name'),
    recordedAt: integer('recorded_at'),
    playbackSize: integer('playback_size'),
    processingProgress: real('processing_progress').notNull().default(0),
    processingError: text('processing_error', {
      enum: ['invalid', 'processing'],
    }),
    parts: text('parts', { mode: 'json' })
      .$type<Record<string, string>>()
      .notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('workout_videos_workout_idx').on(t.ownerId, t.workoutId)],
);
