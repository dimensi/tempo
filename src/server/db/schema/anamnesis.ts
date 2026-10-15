import { isNull } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { user } from '../schema';
import {
  anamnesisDatePrecisions,
  anamnesisImportStages,
  anamnesisImportStatuses,
  anamnesisMarkerCategories,
  anamnesisReferenceAssessments,
  anamnesisReviewReasons,
  anamnesisReviewStatuses,
  anamnesisRevisionReasons,
  anamnesisSourceKinds,
  anamnesisVerifications,
  type AnamnesisObservationValue,
  type MedicalBoundingBox,
  type MedicalObservationFieldChange,
  type MedicalReferenceRange,
} from '@/contracts/anamnesis';

// Справочник канонических показателей общий для всех пользователей:
// гранты и измерения ссылаются на стабильные слаг-идентификаторы.
export const medicalMarkers = sqliteTable('medical_markers', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  shortName: text('short_name'),
  category: text('category', {
    enum: anamnesisMarkerCategories,
  }).notNull(),
  description: text('description'),
  preferredUnit: text('preferred_unit'),
  definitionVersion: integer('definition_version').notNull().default(1),
});

export const medicalMarkerAliases = sqliteTable(
  'medical_marker_aliases',
  {
    id: text('id').primaryKey(),
    markerId: text('marker_id')
      .notNull()
      .references(() => medicalMarkers.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
  },
  (t) => [uniqueIndex('medical_marker_aliases_alias_uq').on(t.alias)],
);

export const medicalDocuments = sqliteTable(
  'medical_documents',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    pageCount: integer('page_count').notNull(),
    laboratoryName: text('laboratory_name'),
    title: text('title'),
    collectedAt: text('collected_at'),
    issuedAt: text('issued_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    // Уникальность только среди живых документов: мягко удалённый файл
    // можно загрузить повторно.
    uniqueIndex('medical_documents_owner_sha_uq')
      .on(t.ownerId, t.sha256)
      .where(isNull(t.deletedAt)),
    index('medical_documents_owner_idx').on(t.ownerId, t.createdAt),
  ],
);

export const medicalImportJobs = sqliteTable(
  'medical_import_jobs',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => medicalDocuments.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: anamnesisImportStatuses,
    }).notNull(),
    stage: text('stage', { enum: anamnesisImportStages }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    leaseUntil: integer('lease_until'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('medical_import_jobs_owner_idx').on(t.ownerId, t.createdAt),
    index('medical_import_jobs_status_idx').on(t.status, t.updatedAt),
  ],
);

export const medicalDocumentPages = sqliteTable(
  'medical_document_pages',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => medicalDocuments.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    width: real('width'),
    height: real('height'),
    hasTextLayer: integer('has_text_layer', { mode: 'boolean' }).notNull(),
    textJson: text('text_json', { mode: 'json' })
      .$type<{ lines: string[] } | null>()
      .notNull(),
    ocrApplied: integer('ocr_applied', { mode: 'boolean' }).notNull(),
  },
  (t) => [
    uniqueIndex('medical_document_pages_page_uq').on(
      t.documentId,
      t.pageNumber,
    ),
  ],
);

export const medicalObservations = sqliteTable(
  'medical_observations',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    markerId: text('marker_id').references(() => medicalMarkers.id),
    originalName: text('original_name').notNull(),
    valueJson: text('value_json', { mode: 'json' })
      .$type<AnamnesisObservationValue>()
      .notNull(),
    originalUnit: text('original_unit'),
    normalizedValue: text('normalized_value'),
    normalizedUnit: text('normalized_unit'),
    collectedAt: text('collected_at'),
    datePrecision: text('date_precision', {
      enum: anamnesisDatePrecisions,
    }).notNull(),
    laboratoryName: text('laboratory_name'),
    referenceJson: text('reference_json', {
      mode: 'json',
    }).$type<MedicalReferenceRange | null>(),
    referenceAssessment: text('reference_assessment', {
      enum: anamnesisReferenceAssessments,
    }).notNull(),
    verification: text('verification', {
      enum: anamnesisVerifications,
    }).notNull(),
    extractionVersion: text('extraction_version').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('medical_observations_owner_marker_idx').on(
      t.ownerId,
      t.markerId,
      t.collectedAt,
    ),
    index('medical_observations_owner_updated_idx').on(t.ownerId, t.updatedAt),
  ],
);

export const medicalObservationSources = sqliteTable(
  'medical_observation_sources',
  {
    id: text('id').primaryKey(),
    observationId: text('observation_id')
      .notNull()
      .references(() => medicalObservations.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => medicalDocuments.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    sourceKind: text('source_kind', {
      enum: anamnesisSourceKinds,
    }).notNull(),
    rawText: text('raw_text').notNull(),
    boundingBoxJson: text('bounding_box_json', {
      mode: 'json',
    }).$type<MedicalBoundingBox | null>(),
    extractionConfidence: real('extraction_confidence'),
  },
  (t) => [
    uniqueIndex('medical_observation_sources_uq').on(
      t.observationId,
      t.documentId,
      t.pageNumber,
      t.sourceKind,
    ),
    index('medical_observation_sources_document_idx').on(t.documentId),
  ],
);

export const medicalReviewItems = sqliteTable(
  'medical_review_items',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    observationId: text('observation_id')
      .notNull()
      .references(() => medicalObservations.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => medicalDocuments.id, { onDelete: 'cascade' }),
    reason: text('reason', { enum: anamnesisReviewReasons }).notNull(),
    status: text('status', { enum: anamnesisReviewStatuses }).notNull(),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
    resolvedBy: text('resolved_by').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('medical_review_items_owner_status_idx').on(t.ownerId, t.status),
    index('medical_review_items_observation_idx').on(t.observationId),
  ],
);

export const medicalObservationRevisions = sqliteTable(
  'medical_observation_revisions',
  {
    id: text('id').primaryKey(),
    observationId: text('observation_id')
      .notNull()
      .references(() => medicalObservations.id, { onDelete: 'cascade' }),
    changedBy: text('changed_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    reason: text('reason', { enum: anamnesisRevisionReasons }).notNull(),
    changesJson: text('changes_json', { mode: 'json' })
      .$type<MedicalObservationFieldChange[]>()
      .notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('medical_observation_revisions_observation_idx').on(
      t.observationId,
      t.createdAt,
    ),
  ],
);

export const medicalReportExports = sqliteTable(
  'medical_report_exports',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    markerIdsJson: text('marker_ids_json', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    dateKeysJson: text('date_keys_json', { mode: 'json' }).$type<
      string[] | null
    >(),
    historicalPeriodJson: text('historical_period_json', {
      mode: 'json',
    }).$type<{ from: string | null; to: string | null } | null>(),
    status: text('status', { enum: ['ready', 'failed'] }).notNull(),
    storageKey: text('storage_key'),
    filename: text('filename').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('medical_report_exports_owner_idx').on(t.ownerId, t.createdAt)],
);

// Второй уровень доступа: тренер видит показатель только по явному гранту.
export const medicalMarkerGrants = sqliteTable(
  'medical_marker_grants',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    trainerId: text('trainer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    markerId: text('marker_id')
      .notNull()
      .references(() => medicalMarkers.id, { onDelete: 'cascade' }),
    grantedAt: integer('granted_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.trainerId, t.markerId] }),
    index('medical_marker_grants_trainer_idx').on(t.trainerId),
  ],
);

// Доступ к оригиналу PDF выдаётся отдельно от доступа к показателю.
export const medicalDocumentGrants = sqliteTable(
  'medical_document_grants',
  {
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    trainerId: text('trainer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => medicalDocuments.id, { onDelete: 'cascade' }),
    grantedAt: integer('granted_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.trainerId, t.documentId] }),
    index('medical_document_grants_trainer_idx').on(t.trainerId),
  ],
);
