import 'server-only';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import {
  nutritionDays,
  nutritionCache,
  nutritionSyncRuns,
} from '@/server/db/schema/nutrition';
import { nutritionPhotos } from '@/server/db/schema/nutrition-photos';
import {
  nutritionDaySchema,
  toSafeMealPhotoView,
  type NutritionDay,
} from '@/contracts/nutrition';
import { syncStatusSchema, type SyncStatus } from '@/contracts/nutrition-sync';

export type PhotoRow = typeof nutritionPhotos.$inferInsert;
export function nutritionRepository(database = getDatabase()) {
  const { db } = database;
  const dayWhere = (ownerId: string, date: string) =>
    and(eq(nutritionDays.ownerId, ownerId), eq(nutritionDays.date, date));
  const photoWhere = (ownerId: string, date: string) =>
    and(eq(nutritionPhotos.ownerId, ownerId), eq(nutritionPhotos.date, date));
  return {
    day(ownerId: string, date: string) {
      const row = db
        .select()
        .from(nutritionDays)
        .where(dayWhere(ownerId, date))
        .get();
      return row ? nutritionDaySchema.parse(JSON.parse(row.snapshot)) : null;
    },
    list(ownerId: string, from: string, to: string) {
      return db
        .select()
        .from(nutritionDays)
        .where(
          and(
            eq(nutritionDays.ownerId, ownerId),
            gte(nutritionDays.date, from),
            lte(nutritionDays.date, to),
          ),
        )
        .orderBy(asc(nutritionDays.date))
        .all()
        .map((r) => nutritionDaySchema.parse(JSON.parse(r.snapshot)));
    },
    photos(ownerId: string, date: string) {
      return db
        .select()
        .from(nutritionPhotos)
        .where(photoWhere(ownerId, date))
        .orderBy(asc(nutritionPhotos.observedAt), asc(nutritionPhotos.id))
        .all()
        .map(toSafeMealPhotoView);
    },
    listPhotos(ownerId: string, from: string, to: string) {
      return db
        .select()
        .from(nutritionPhotos)
        .where(
          and(
            eq(nutritionPhotos.ownerId, ownerId),
            gte(nutritionPhotos.date, from),
            lte(nutritionPhotos.date, to),
          ),
        )
        .orderBy(
          asc(nutritionPhotos.date),
          asc(nutritionPhotos.observedAt),
          asc(nutritionPhotos.id),
        )
        .all()
        .map(toSafeMealPhotoView);
    },
    photo(ownerId: string, id: string) {
      return (
        db
          .select()
          .from(nutritionPhotos)
          .where(
            and(
              eq(nutritionPhotos.ownerId, ownerId),
              eq(nutritionPhotos.id, id),
            ),
          )
          .get() ?? null
      );
    },
    replaceDay(ownerId: string, day: NutritionDay, photos: PhotoRow[]) {
      nutritionDaySchema.parse(day);
      if (
        photos.some(
          (p) =>
            p.ownerId !== ownerId ||
            p.date !== day.date ||
            p.source !== 'yazio',
        )
      )
        throw new Error('Invalid photo grouping');
      db.transaction((tx) => {
        tx.insert(nutritionDays)
          .values({
            ownerId,
            date: day.date,
            snapshot: JSON.stringify(day),
            fetchedAt: day.fetchedAt,
          })
          .onConflictDoUpdate({
            target: [nutritionDays.ownerId, nutritionDays.date],
            set: { snapshot: JSON.stringify(day), fetchedAt: day.fetchedAt },
          })
          .run();
        tx.delete(nutritionPhotos)
          .where(
            and(
              photoWhere(ownerId, day.date),
              eq(nutritionPhotos.source, 'yazio'),
            ),
          )
          .run();
        if (photos.length) tx.insert(nutritionPhotos).values(photos).run();
      });
    },
    addPhoto(photo: PhotoRow) {
      db.insert(nutritionPhotos).values(photo).run();
    },
    deleteManual(ownerId: string, id: string) {
      return (
        db
          .delete(nutritionPhotos)
          .where(
            and(
              eq(nutritionPhotos.ownerId, ownerId),
              eq(nutritionPhotos.id, id),
              eq(nutritionPhotos.source, 'manual'),
            ),
          )
          .run().changes > 0
      );
    },
    cache(ownerId: string, kind: 'product' | 'recipe', id: string) {
      const row = db
        .select()
        .from(nutritionCache)
        .where(
          and(
            eq(nutritionCache.ownerId, ownerId),
            eq(nutritionCache.kind, kind),
            eq(nutritionCache.id, id),
          ),
        )
        .get();
      return row && Date.now() - Date.parse(row.fetchedAt) < 86400000
        ? { payload: JSON.parse(row.payload) as unknown }
        : null;
    },
    putCache(
      ownerId: string,
      kind: 'product' | 'recipe',
      id: string,
      payload: unknown,
    ) {
      const row = {
        ownerId,
        kind,
        id,
        payload: JSON.stringify(payload),
        fetchedAt: new Date().toISOString(),
      };
      db.insert(nutritionCache)
        .values(row)
        .onConflictDoUpdate({
          target: [
            nutritionCache.ownerId,
            nutritionCache.kind,
            nutritionCache.id,
          ],
          set: { payload: row.payload, fetchedAt: row.fetchedAt },
        })
        .run();
    },
    status(ownerId: string): SyncStatus {
      const row = db
        .select()
        .from(nutritionSyncRuns)
        .where(eq(nutritionSyncRuns.ownerId, ownerId))
        .get();
      return row
        ? syncStatusSchema.parse(JSON.parse(row.status))
        : {
            state: 'idle',
            startedAt: null,
            finishedAt: null,
            completedDates: [],
            failedDates: [],
          };
    },
    saveStatus(ownerId: string, status: SyncStatus) {
      const row = {
        ownerId,
        status: JSON.stringify(syncStatusSchema.parse(status)),
      };
      db.insert(nutritionSyncRuns)
        .values(row)
        .onConflictDoUpdate({
          target: nutritionSyncRuns.ownerId,
          set: { status: row.status },
        })
        .run();
    },
  };
}
export type NutritionRepository = ReturnType<typeof nutritionRepository>;
