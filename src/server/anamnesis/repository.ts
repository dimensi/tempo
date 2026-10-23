import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { user, trainerAccess } from '@/server/db/schema';
import {
  medicalDocuments,
  medicalImportJobs,
  medicalDocumentPages,
  medicalMarkers,
  medicalMarkerAliases,
  medicalObservations,
  medicalObservationSources,
  medicalReviewItems,
  medicalObservationRevisions,
  medicalReportExports,
} from '@/server/db/schema/anamnesis';
import type { AnamnesisObservationValue } from '@/contracts/anamnesis';

type Db = ReturnType<typeof getDatabase>['db'];

export type MedicalDocumentRow = typeof medicalDocuments.$inferSelect;
export type MedicalImportJobRow = typeof medicalImportJobs.$inferSelect;
export type MedicalObservationRow = typeof medicalObservations.$inferSelect;
export type MedicalObservationSourceRow =
  typeof medicalObservationSources.$inferSelect;
export type MedicalReviewItemRow = typeof medicalReviewItems.$inferSelect;
export type MedicalObservationRevisionRow =
  typeof medicalObservationRevisions.$inferSelect;
export type MedicalReportExportRow = typeof medicalReportExports.$inferSelect;
export type MedicalMarkerRow = typeof medicalMarkers.$inferSelect;

const documentScope = (ownerId: string, id: string) =>
  and(
    eq(medicalDocuments.ownerId, ownerId),
    eq(medicalDocuments.id, id),
    isNull(medicalDocuments.deletedAt),
  );

export function anamnesisRepository(db: Db = getDatabase().db) {
  function pendingReviewCount(ownerId: string) {
    const conditions = [
      eq(medicalReviewItems.ownerId, ownerId),
      eq(medicalReviewItems.status, 'pending'),
    ];
    return (
      db
        .select({ count: sql<number>`count(*)` })
        .from(medicalReviewItems)
        .where(and(...conditions))
        .get()?.count ?? 0
    );
  }
  return {
    // --- Каталог
    listMarkers: () =>
      db.select().from(medicalMarkers).orderBy(medicalMarkers.name).all(),
    listAliases: () => db.select().from(medicalMarkerAliases).all(),
    findMarker: (markerId: string) =>
      db
        .select()
        .from(medicalMarkers)
        .where(eq(medicalMarkers.id, markerId))
        .get(),

    // --- Документы
    findDocumentBySha: (ownerId: string, sha256: string) =>
      db
        .select()
        .from(medicalDocuments)
        .where(
          and(
            eq(medicalDocuments.ownerId, ownerId),
            eq(medicalDocuments.sha256, sha256),
            isNull(medicalDocuments.deletedAt),
          ),
        )
        .get(),
    insertDocument: (row: typeof medicalDocuments.$inferInsert) =>
      db.insert(medicalDocuments).values(row).returning().get(),
    findDocument: (ownerId: string, id: string) =>
      db
        .select()
        .from(medicalDocuments)
        .where(documentScope(ownerId, id))
        .get(),
    listDocuments: (ownerId: string) =>
      db
        .select()
        .from(medicalDocuments)
        .where(
          and(
            eq(medicalDocuments.ownerId, ownerId),
            isNull(medicalDocuments.deletedAt),
          ),
        )
        .orderBy(desc(medicalDocuments.createdAt))
        .all(),
    updateDocument: (
      ownerId: string,
      id: string,
      patch: Partial<
        Pick<
          MedicalDocumentRow,
          'laboratoryName' | 'title' | 'collectedAt' | 'issuedAt'
        >
      >,
    ) =>
      db
        .update(medicalDocuments)
        .set({ ...patch, updatedAt: Date.now() })
        .where(documentScope(ownerId, id))
        .returning()
        .get(),
    softDeleteDocument: (ownerId: string, id: string) =>
      db
        .update(medicalDocuments)
        .set({ deletedAt: Date.now(), updatedAt: Date.now() })
        .where(documentScope(ownerId, id))
        .returning({ id: medicalDocuments.id })
        .get(),

    // --- Задания импорта
    insertJob: (row: typeof medicalImportJobs.$inferInsert) =>
      db.insert(medicalImportJobs).values(row).returning().get(),
    findJob: (ownerId: string, id: string) =>
      db
        .select()
        .from(medicalImportJobs)
        .where(
          and(
            eq(medicalImportJobs.ownerId, ownerId),
            eq(medicalImportJobs.id, id),
          ),
        )
        .get(),
    listJobs: (ownerId: string, limit = 50) =>
      db
        .select()
        .from(medicalImportJobs)
        .where(eq(medicalImportJobs.ownerId, ownerId))
        .orderBy(desc(medicalImportJobs.createdAt))
        .limit(limit)
        .all(),
    // Очередь глобальная: один процесс приложения, аренда защищает от зависших заданий.
    // Аренда счётает попытку; исчерпавшие попытки задания не забираются.
    claimNextJob: (leaseUntil: number, maxAttempts = 3) =>
      db
        .update(medicalImportJobs)
        .set({
          status: 'processing',
          attempts: sql`${medicalImportJobs.attempts} + 1`,
          updatedAt: Date.now(),
          leaseUntil,
        })
        .where(
          and(
            eq(
              medicalImportJobs.id,
              sql`(
              select id from ${medicalImportJobs}
              where attempts < ${maxAttempts}
                and (
                  status = 'queued'
                  or (status = 'processing' and lease_until is not null and lease_until < ${Date.now()})
                )
              order by created_at asc limit 1
            )`,
            ),
          ),
        )
        .returning()
        .get(),
    findJobById: (id: string) =>
      db
        .select()
        .from(medicalImportJobs)
        .where(eq(medicalImportJobs.id, id))
        .get(),
    updateJob: (
      id: string,
      patch: Partial<
        Pick<
          MedicalImportJobRow,
          | 'status'
          | 'stage'
          | 'attempts'
          | 'lastError'
          | 'leaseUntil'
          | 'failedPages'
        >
      >,
    ) =>
      db
        .update(medicalImportJobs)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(medicalImportJobs.id, id))
        .returning()
        .get(),

    // --- Измерения
    insertObservation: (row: typeof medicalObservations.$inferInsert) =>
      db.insert(medicalObservations).values(row).returning().get(),
    findObservation: (ownerId: string, id: string) =>
      db
        .select()
        .from(medicalObservations)
        .where(
          and(
            eq(medicalObservations.ownerId, ownerId),
            eq(medicalObservations.id, id),
          ),
        )
        .get(),
    findObservationAny: (id: string) =>
      db
        .select()
        .from(medicalObservations)
        .where(eq(medicalObservations.id, id))
        .get(),
    listObservations: (
      ownerId: string,
      filter: { markerIds?: string[]; from?: string; to?: string },
    ) => {
      const conditions = [
        eq(medicalObservations.ownerId, ownerId),
        ne(medicalObservations.verification, 'rejected'),
      ];
      if (filter.markerIds?.length)
        conditions.push(
          inArray(medicalObservations.markerId, filter.markerIds),
        );
      if (filter.from)
        conditions.push(gte(medicalObservations.collectedAt, filter.from));
      if (filter.to)
        conditions.push(lte(medicalObservations.collectedAt, `${filter.to}Z`));
      return db
        .select()
        .from(medicalObservations)
        .where(and(...conditions))
        .orderBy(medicalObservations.collectedAt, medicalObservations.createdAt)
        .all();
    },
    // Точное совпадение для дедупликации между документами.
    // Симметрично точности дат: точное совпадение — тот же день (префикс
    // в любую сторону) либо обе даты неизвестны, при равных значении,
    // единице и лаборатории.
    findExactObservation: (
      ownerId: string,
      match: {
        markerId: string;
        collectedAt: string | null;
        value: AnamnesisObservationValue;
        originalUnit: string | null;
        laboratoryName: string | null;
      },
    ) => {
      const day = match.collectedAt?.slice(0, 10) ?? null;
      return (
        db
          .select()
          .from(medicalObservations)
          .where(
            and(
              eq(medicalObservations.ownerId, ownerId),
              eq(medicalObservations.markerId, match.markerId),
              ne(medicalObservations.verification, 'rejected'),
              eq(medicalObservations.valueJson, match.value),
              match.originalUnit === null
                ? isNull(medicalObservations.originalUnit)
                : eq(medicalObservations.originalUnit, match.originalUnit),
              match.laboratoryName === null
                ? isNull(medicalObservations.laboratoryName)
                : eq(medicalObservations.laboratoryName, match.laboratoryName),
            ),
          )
          .all()
          .find((row) => {
            const stored = row.collectedAt ?? null;
            if (day === null || stored === null) return day === stored;
            return stored.startsWith(day) || day.startsWith(stored);
          }) ?? null
      );
    },
    // Кандидаты на возможный дубль: тот же показатель и день (точное
    // совпадение даты или её префикс при разной точности).
    // Симметрично точности дат: день кандидата покрывает сохранённые
    // месяц/дату и наоборот (LIKE односторонний, фильтруем в JS).
    findObservationsByMarkerAndDay: (
      ownerId: string,
      markerId: string,
      day: string,
    ) =>
      db
        .select()
        .from(medicalObservations)
        .where(
          and(
            eq(medicalObservations.ownerId, ownerId),
            eq(medicalObservations.markerId, markerId),
            ne(medicalObservations.verification, 'rejected'),
          ),
        )
        .all()
        .filter((row) => {
          const stored = row.collectedAt ?? '';
          return stored.startsWith(day) || day.startsWith(stored);
        }),
    updateObservation: (
      ownerId: string,
      id: string,
      expectedRevision: number,
      patch: Partial<
        Pick<
          MedicalObservationRow,
          | 'markerId'
          | 'valueJson'
          | 'originalUnit'
          | 'normalizedValue'
          | 'normalizedUnit'
          | 'collectedAt'
          | 'datePrecision'
          | 'referenceJson'
          | 'referenceAssessment'
          | 'verification'
        >
      >,
    ) =>
      db
        .update(medicalObservations)
        .set({
          ...patch,
          revision: expectedRevision + 1,
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(medicalObservations.ownerId, ownerId),
            eq(medicalObservations.id, id),
            eq(medicalObservations.revision, expectedRevision),
          ),
        )
        .returning()
        .get(),
    // Повторная обработка: удаляются только автоматические результаты импорта,
    // все источники которых лежат внутри перерабатываемого документа.
    deleteImportedObservations: (documentId: string, pageNumbers: number[]) => {
      if (!pageNumbers.length) return 0;
      const removable = db
        .select({ id: medicalObservations.id })
        .from(medicalObservations)
        .where(
          and(
            ne(medicalObservations.verification, 'user_verified'),
            sql`exists (
              select 1 from ${medicalObservationSources} source_inside
              where source_inside.observation_id = ${medicalObservations.id}
                and source_inside.document_id = ${documentId}
                and source_inside.page_number in (${sql.join(
                  pageNumbers.map((page) => sql`${page}`),
                  sql`, `,
                )})
            )`,
            sql`not exists (
              select 1 from ${medicalObservationSources} source_outside
              where source_outside.observation_id = ${medicalObservations.id}
                and (source_outside.document_id != ${documentId}
                  or source_outside.page_number not in (${sql.join(
                    pageNumbers.map((page) => sql`${page}`),
                    sql`, `,
                  )}))
            )`,
          ),
        )
        .all()
        .map((row) => row.id);
      if (removable.length)
        db.delete(medicalObservations)
          .where(inArray(medicalObservations.id, removable))
          .run();
      return removable.length;
    },

    // --- Страницы
    replacePages: (
      documentId: string,
      rows: Array<typeof medicalDocumentPages.$inferInsert>,
    ) => {
      db.delete(medicalDocumentPages)
        .where(eq(medicalDocumentPages.documentId, documentId))
        .run();
      if (rows.length) db.insert(medicalDocumentPages).values(rows).run();
    },

    // --- Источники
    insertSources: (
      rows: Array<typeof medicalObservationSources.$inferInsert>,
    ) => {
      if (rows.length)
        db.insert(medicalObservationSources)
          .values(rows)
          .onConflictDoNothing()
          .run();
    },
    listSources: (observationId: string) =>
      db
        .select()
        .from(medicalObservationSources)
        .where(eq(medicalObservationSources.observationId, observationId))
        .all(),
    listObservationsByDocument: (ownerId: string, documentId: string) => [
      ...new Map(
        db
          .select({ observation: medicalObservations })
          .from(medicalObservations)
          .innerJoin(
            medicalObservationSources,
            eq(medicalObservationSources.observationId, medicalObservations.id),
          )
          .where(
            and(
              eq(medicalObservations.ownerId, ownerId),
              eq(medicalObservationSources.documentId, documentId),
            ),
          )
          .all()
          .map((row) => [row.observation.id, row.observation] as const),
      ).values(),
    ],
    listSourcesForObservations: (observationIds: string[]) =>
      observationIds.length
        ? db
            .select()
            .from(medicalObservationSources)
            .where(
              inArray(medicalObservationSources.observationId, observationIds),
            )
            .all()
        : [],

    // --- Очередь проверки
    insertReview: (row: typeof medicalReviewItems.$inferInsert) =>
      db.insert(medicalReviewItems).values(row).returning().get(),
    listPendingReviews: (ownerId: string) =>
      db
        .select()
        .from(medicalReviewItems)
        .where(
          and(
            eq(medicalReviewItems.ownerId, ownerId),
            eq(medicalReviewItems.status, 'pending'),
          ),
        )
        .orderBy(desc(medicalReviewItems.createdAt))
        .all(),
    countPendingReviews: (ownerId: string, markerIds?: string[]) =>
      pendingReviewCount(ownerId, markerIds),
    findReview: (ownerId: string, id: string) =>
      db
        .select()
        .from(medicalReviewItems)
        .where(
          and(
            eq(medicalReviewItems.ownerId, ownerId),
            eq(medicalReviewItems.id, id),
          ),
        )
        .get(),
    resolveReview: (
      id: string,
      resolution: 'resolved' | 'rejected',
      resolvedBy: string,
    ) =>
      db
        .update(medicalReviewItems)
        .set({ status: resolution, resolvedAt: Date.now(), resolvedBy })
        .where(
          and(
            eq(medicalReviewItems.id, id),
            eq(medicalReviewItems.status, 'pending'),
          ),
        )
        .returning()
        .get(),

    // --- История изменений
    insertRevision: (row: typeof medicalObservationRevisions.$inferInsert) =>
      db.insert(medicalObservationRevisions).values(row).returning().get(),
    listRevisions: (observationId: string) =>
      db
        .select()
        .from(medicalObservationRevisions)
        .where(eq(medicalObservationRevisions.observationId, observationId))
        .orderBy(medicalObservationRevisions.createdAt)
        .all(),

    // --- Отчёты
    insertReport: (row: typeof medicalReportExports.$inferInsert) =>
      db.insert(medicalReportExports).values(row).returning().get(),
    listReports: (ownerId: string) =>
      db
        .select()
        .from(medicalReportExports)
        .where(eq(medicalReportExports.ownerId, ownerId))
        .orderBy(desc(medicalReportExports.createdAt))
        .all(),
    findReport: (ownerId: string, id: string) =>
      db
        .select()
        .from(medicalReportExports)
        .where(
          and(
            eq(medicalReportExports.ownerId, ownerId),
            eq(medicalReportExports.id, id),
          ),
        )
        .get(),
    deleteReport: (ownerId: string, id: string) =>
      db
        .delete(medicalReportExports)
        .where(
          and(
            eq(medicalReportExports.ownerId, ownerId),
            eq(medicalReportExports.id, id),
          ),
        )
        .returning({ id: medicalReportExports.id })
        .get(),

    // Тренеры с действующим trainer_access и их медицинские гранты.
    listGrantTrainers: (ownerId: string) =>
      db
        .select({
          trainerId: trainerAccess.trainerId,
          enabled: trainerAccess.anamnesisAccess,
          name: user.name,
          email: user.email,
        })
        .from(trainerAccess)
        .innerJoin(user, eq(user.id, trainerAccess.trainerId))
        .where(eq(trainerAccess.ownerId, ownerId))
        .all(),

    // --- Сводка по данным владельца; медицинский доступ проверяет общий guard.
    overview: (ownerId: string) => {
      const observationWhere = and(
        eq(medicalObservations.ownerId, ownerId),
        ne(medicalObservations.verification, 'rejected'),
      );
      const documents =
        db
          .select({ count: sql<number>`count(*)` })
          .from(medicalDocuments)
          .where(
            and(
              eq(medicalDocuments.ownerId, ownerId),
              isNull(medicalDocuments.deletedAt),
            ),
          )
          .get()?.count ?? 0;
      const observations =
        db
          .select({ count: sql<number>`count(*)` })
          .from(medicalObservations)
          .where(observationWhere)
          .get()?.count ?? 0;
      const activeImports =
        db
          .select({ count: sql<number>`count(*)` })
          .from(medicalImportJobs)
          .where(
            and(
              eq(medicalImportJobs.ownerId, ownerId),
              inArray(medicalImportJobs.status, ['queued', 'processing']),
            ),
          )
          .get()?.count ?? 0;
      const lastCollectedAt =
        db
          .select({
            value: sql<string | null>`max(${medicalObservations.collectedAt})`,
          })
          .from(medicalObservations)
          .where(observationWhere)
          .get()?.value ?? null;
      return {
        documents,
        observations,
        pendingReviews: pendingReviewCount(ownerId),
        activeImports,
        lastCollectedAt,
      };
    },
    markersWithObservations: (ownerId: string) =>
      db
        .select({
          markerId: medicalObservations.markerId,
          count: sql<number>`count(*)`,
        })
        .from(medicalObservations)
        .where(
          and(
            eq(medicalObservations.ownerId, ownerId),
            ne(medicalObservations.verification, 'rejected'),
          ),
        )
        .groupBy(medicalObservations.markerId)
        .all(),
  };
}

export function anamnesisId() {
  return randomUUID();
}
