import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';
import { workoutSessions } from './workouts';
export const workoutVideos = sqliteTable(
  'workout_videos',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id').notNull(),
    size: integer('size').notNull(),
    duration: integer('duration').notNull(),
    state: text('state', { enum: ['uploading', 'ready'] }).notNull(),
    parts: text('parts', { mode: 'json' })
      .$type<Record<string, string>>()
      .notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('workout_videos_session_idx').on(t.ownerId, t.sessionId)],
);
