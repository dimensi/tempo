import 'server-only';
import { and, eq, gte, lte } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { yazioDailyGoals } from '@/server/db/schema/yazio-health';
import { dailyGoalsSchema, type DailyGoals } from '@/contracts/daily-goals';
export function dailyGoalsRepository(database = getDatabase()) {
  const { db } = database;
  return {
    save(ownerId: string, input: DailyGoals) {
      const value = dailyGoalsSchema.parse(input);
      if (!value.fetchedAt) throw new Error('Missing goal observation time');
      db.insert(yazioDailyGoals)
        .values({ ownerId, ...value, fetchedAt: value.fetchedAt })
        .onConflictDoUpdate({
          target: [yazioDailyGoals.ownerId, yazioDailyGoals.date],
          set: { ...value, fetchedAt: value.fetchedAt },
        })
        .run();
    },
    list(ownerId: string, range: { from: string; to: string }) {
      return db
        .select()
        .from(yazioDailyGoals)
        .where(
          and(
            eq(yazioDailyGoals.ownerId, ownerId),
            gte(yazioDailyGoals.date, range.from),
            lte(yazioDailyGoals.date, range.to),
          ),
        )
        .all()
        .map((row) =>
          dailyGoalsSchema.parse({
            date: row.date,
            calories: row.calories,
            weight: row.weight,
            steps: row.steps,
            fetchedAt: row.fetchedAt,
          }),
        );
    },
    day(ownerId: string, date: string): DailyGoals {
      const row = db
        .select()
        .from(yazioDailyGoals)
        .where(
          and(
            eq(yazioDailyGoals.ownerId, ownerId),
            eq(yazioDailyGoals.date, date),
          ),
        )
        .get();
      return dailyGoalsSchema.parse(
        row
          ? {
              date: row.date,
              calories: row.calories,
            weight: row.weight,
              steps: row.steps,
              fetchedAt: row.fetchedAt,
            }
          : { date, calories: null, weight: null, steps: null, fetchedAt: null },
      );
    },
  };
}
