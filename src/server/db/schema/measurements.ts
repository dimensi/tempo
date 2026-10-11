import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { user } from '@/server/db/schema';
import type { MeasurementInput } from '@/contracts/measurements';
export const measurements = sqliteTable(
  'measurements',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    measuredAt: text('measured_at').notNull(),
    values: text('values_json', { mode: 'json' })
      .$type<MeasurementInput['values']>()
      .notNull(),
    note: text('note'),
  },
  (t) => [index('measurements_owner_date_idx').on(t.ownerId, t.measuredAt)],
);
