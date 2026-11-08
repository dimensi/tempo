import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';

function target() {
  return {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountScope: text('account_scope').notNull(),
    exerciseId: integer('exercise_id').notNull(),
  };
}

export const exerciseTechniqueDescriptions = sqliteTable(
  'exercise_technique_descriptions',
  {
    ...target(),
    description: text('description'),
    revision: integer('revision').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.accountScope, t.exerciseId] })],
);

export const exerciseTechniqueVideos = sqliteTable(
  'exercise_technique_videos',
  {
    id: text('id').primaryKey(),
    ...target(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    lastModified: integer('last_modified'),
    parts: text('parts', { mode: 'json' })
      .$type<Record<string, string>>()
      .notNull(),
    state: text('state', {
      enum: ['uploading', 'processing', 'failed', 'ready', 'retired'],
    }).notNull(),
    progress: real('progress').notNull().default(0),
    error: text('error', { enum: ['invalid', 'processing'] }),
    playbackSize: integer('playback_size'),
    submittedBy: text('submitted_by'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('exercise_technique_ready_idx')
      .on(t.ownerId, t.accountScope, t.exerciseId)
      .where(sql`${t.state} = 'ready'`),
    uniqueIndex('exercise_technique_candidate_idx')
      .on(t.ownerId, t.accountScope, t.exerciseId)
      .where(sql`${t.state} in ('uploading', 'processing', 'failed')`),
    index('exercise_technique_jobs_idx').on(t.state, t.createdAt),
  ],
);
