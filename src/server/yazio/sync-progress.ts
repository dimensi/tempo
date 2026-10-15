import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { yazioSyncProgress } from '@/server/db/schema/yazio-sync-progress';
import { shiftDate } from '@/contracts/nutrition-sync-dates';

export const syncParts = ['food', 'photos', 'steps', 'weight', 'body'] as const;
export type SyncPart = (typeof syncParts)[number];
export type DayWork = Record<SyncPart, boolean>;

export function syncProgress(
  database: Pick<ReturnType<typeof getDatabase>, 'db'> = getDatabase(),
) {
  const { db } = database;
  function set(ownerId: string, date: string, values: Partial<DayWork>) {
    db.insert(yazioSyncProgress)
      .values({ ownerId, date, ...values })
      .onConflictDoUpdate({
        target: [yazioSyncProgress.ownerId, yazioSyncProgress.date],
        set: values,
      })
      .run();
  }
  return {
    set,
    plan(ownerId: string, dates: string[], today: string, force: boolean) {
      const rows = db
        .select()
        .from(yazioSyncProgress)
        .where(eq(yazioSyncProgress.ownerId, ownerId))
        .all();
      const saved = new Map(rows.map((row) => [row.date, row]));
      const yesterday = shiftDate(today, -1);
      return new Map(
        dates.map((date) => [
          date,
          Object.fromEntries(
            syncParts.map((part) => [
              part,
              force || date >= yesterday || !saved.get(date)?.[part],
            ]),
          ) as DayWork,
        ]),
      );
    },
    get(ownerId: string, date: string) {
      return db
        .select()
        .from(yazioSyncProgress)
        .where(
          and(
            eq(yazioSyncProgress.ownerId, ownerId),
            eq(yazioSyncProgress.date, date),
          ),
        )
        .get();
    },
  };
}
