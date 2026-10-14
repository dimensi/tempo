import { z } from 'zod';

// Хранит десятичные значения строками: двоичная арифметика JS теряет точность.
export const anamnesisDecimal = z
  .string()
  .regex(
    /^-?\d{1,7}(\.\d{1,6})?$/,
    'Десятичное значение до 6 знаков после точки',
  );
export const anamnesisPartialDate = z
  .string()
  .regex(
    /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2})?)?)?)?$/,
    'Дата вида YYYY-MM-DD, YYYY-MM, YYYY или с временем',
  );
export const anamnesisMarkerSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'Слаг показателя');
const id = z.string().uuid();
const epoch = z.number().int().min(0);

export const anamnesisMarkerCategories = [
  'vitamins',
  'biochemistry',
  'hematology',
  'hormones',
  'other',
] as const;
export type AnamnesisMarkerCategory =
  (typeof anamnesisMarkerCategories)[number];

export const anamnesisComparators = ['eq', 'lt', 'lte', 'gt', 'gte'] as const;
export const anamnesisVerifications = [
  'auto_verified',
  'user_verified',
  'needs_review',
  'rejected',
] as const;
export const anamnesisReferenceAssessments = [
  'below',
  'within',
  'above',
  'unknown',
] as const;
export const anamnesisDatePrecisions = [
  'datetime',
  'date',
  'month',
  'unknown',
] as const;
export const anamnesisSourceKinds = [
  'current_result',
  'historical_result',
  'manual',
] as const;
export const anamnesisImportStatuses = [
  'queued',
  'processing',
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
] as const;
export const anamnesisImportStages = [
  'upload_validation',
  'pdf_extraction',
  'ocr',
  'structured_extraction',
  'normalization',
  'validation',
  'persistence',
] as const;
export const anamnesisReviewReasons = [
  'unknown_source_kind',
  'ambiguous_marker',
  'missing_origin',
  'missing_date',
  'unknown_unit',
  'contradiction',
  'possible_duplicate',
  'value_type',
] as const;
export const anamnesisReviewStatuses = [
  'pending',
  'resolved',
  'rejected',
] as const;
export const anamnesisRevisionReasons = [
  'import',
  'edit',
  'review_confirm',
  'review_reject',
] as const;

export const medicalMarkerSchema = z
  .object({
    id: anamnesisMarkerSlug,
    code: z.string().regex(/^[A-Z0-9]{2,16}$/),
    name: z.string().min(1).max(200),
    shortName: z.string().min(1).max(100).nullable(),
    category: z.enum(anamnesisMarkerCategories),
    description: z.string().min(1).max(1000).nullable(),
    preferredUnit: z.string().min(1).max(30).nullable(),
    definitionVersion: z.number().int().min(1),
  })
  .strict();
export type MedicalMarker = z.infer<typeof medicalMarkerSchema>;

export const medicalDocumentSchema = z
  .object({
    id,
    ownerId: id,
    filename: z.string().min(1).max(255),
    storageKey: z.string().min(1).max(300),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mimeType: z.literal('application/pdf'),
    sizeBytes: z.number().int().min(1),
    pageCount: z.number().int().min(1),
    laboratoryName: z.string().min(1).max(200).nullable(),
    title: z.string().min(1).max(300).nullable(),
    collectedAt: z.iso.date().nullable(),
    issuedAt: z.iso.date().nullable(),
    createdAt: epoch,
    updatedAt: epoch,
    deletedAt: epoch.nullable(),
  })
  .strict();
export type MedicalDocument = z.infer<typeof medicalDocumentSchema>;

export const medicalImportJobSchema = z
  .object({
    id,
    ownerId: id,
    documentId: id,
    status: z.enum(anamnesisImportStatuses),
    stage: z.enum(anamnesisImportStages),
    attempts: z.number().int().min(0),
    lastError: z.string().min(1).max(500).nullable(),
    createdAt: epoch,
    updatedAt: epoch,
  })
  .strict();
export type MedicalImportJob = z.infer<typeof medicalImportJobSchema>;

export const medicalBoundingBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  })
  .strict();
export type MedicalBoundingBox = z.infer<typeof medicalBoundingBoxSchema>;

export const anamnesisObservationValueSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('numeric'),
      value: anamnesisDecimal,
      comparator: z.enum(anamnesisComparators),
    })
    .strict(),
  z
    .object({ kind: z.literal('text'), value: z.string().min(1).max(500) })
    .strict(),
]);
export type AnamnesisObservationValue = z.infer<
  typeof anamnesisObservationValueSchema
>;

export const medicalReferenceRangeSchema = z
  .object({
    lower: anamnesisDecimal.nullable(),
    upper: anamnesisDecimal.nullable(),
    lowerInclusive: z.boolean().nullable(),
    upperInclusive: z.boolean().nullable(),
    originalText: z.string().min(1).max(200),
  })
  .strict()
  .refine((range) => range.lower !== null || range.upper !== null, {
    message: 'Нужна хотя бы одна граница референса',
  });
export type MedicalReferenceRange = z.infer<typeof medicalReferenceRangeSchema>;

export const medicalObservationSchema = z
  .object({
    id,
    ownerId: id,
    markerId: anamnesisMarkerSlug.nullable(),
    originalName: z.string().min(1).max(300),
    value: anamnesisObservationValueSchema,
    originalUnit: z.string().min(1).max(30).nullable(),
    normalizedValue: anamnesisDecimal.nullable(),
    normalizedUnit: z.string().min(1).max(30).nullable(),
    collectedAt: anamnesisPartialDate.nullable(),
    datePrecision: z.enum(anamnesisDatePrecisions),
    laboratoryName: z.string().min(1).max(200).nullable(),
    referenceRange: medicalReferenceRangeSchema.nullable(),
    referenceAssessment: z.enum(anamnesisReferenceAssessments),
    verification: z.enum(anamnesisVerifications),
    extractionVersion: z.string().min(1).max(20),
    revision: z.number().int().min(1),
    createdAt: epoch,
    updatedAt: epoch,
  })
  .strict();
export type MedicalObservation = z.infer<typeof medicalObservationSchema>;

export const medicalObservationSourceSchema = z
  .object({
    id,
    observationId: id,
    documentId: id,
    pageNumber: z.number().int().min(1),
    sourceKind: z.enum(anamnesisSourceKinds),
    rawText: z.string().min(1).max(2000),
    boundingBox: medicalBoundingBoxSchema.nullable(),
    extractionConfidence: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type MedicalObservationSource = z.infer<
  typeof medicalObservationSourceSchema
>;

export const medicalReviewItemSchema = z
  .object({
    id,
    ownerId: id,
    observationId: id,
    documentId: id,
    reason: z.enum(anamnesisReviewReasons),
    status: z.enum(anamnesisReviewStatuses),
    createdAt: epoch,
    resolvedAt: epoch.nullable(),
    resolvedBy: id.nullable(),
  })
  .strict();
export type MedicalReviewItem = z.infer<typeof medicalReviewItemSchema>;

export const medicalObservationFieldChangeSchema = z
  .object({
    field: z.string().min(1).max(40),
    from: z.string().max(500).nullable(),
    to: z.string().max(500).nullable(),
  })
  .strict();
export type MedicalObservationFieldChange = z.infer<
  typeof medicalObservationFieldChangeSchema
>;

export const medicalObservationRevisionSchema = z
  .object({
    id,
    observationId: id,
    changedBy: id,
    reason: z.enum(anamnesisRevisionReasons),
    changes: z.array(medicalObservationFieldChangeSchema).min(1),
    createdAt: epoch,
  })
  .strict();
export type MedicalObservationRevision = z.infer<
  typeof medicalObservationRevisionSchema
>;

export const medicalReportRequestSchema = z
  .object({
    markerIds: z.array(anamnesisMarkerSlug).min(1).max(50),
    from: z.iso.date().nullable(),
    to: z.iso.date().nullable(),
  })
  .strict();
export type MedicalReportRequest = z.infer<typeof medicalReportRequestSchema>;

export const medicalReportExportSchema = z
  .object({
    id,
    ownerId: id,
    createdBy: id,
    markerIds: z.array(anamnesisMarkerSlug).min(1),
    from: z.iso.date().nullable(),
    to: z.iso.date().nullable(),
    status: z.enum(['ready', 'failed']),
    filename: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(0),
    createdAt: epoch,
  })
  .strict();
export type MedicalReportExport = z.infer<typeof medicalReportExportSchema>;

export const medicalMarkerGrantSchema = z
  .object({
    ownerId: id,
    trainerId: id,
    markerId: anamnesisMarkerSlug,
    grantedAt: epoch,
  })
  .strict();
export type MedicalMarkerGrant = z.infer<typeof medicalMarkerGrantSchema>;

export const medicalDocumentGrantSchema = z
  .object({ ownerId: id, trainerId: id, documentId: id, grantedAt: epoch })
  .strict();
export type MedicalDocumentGrant = z.infer<typeof medicalDocumentGrantSchema>;

export const anamnesisGrantInputSchema = z
  .object({ trainerId: id, enabled: z.boolean() })
  .strict();
export type AnamnesisGrantInput = z.infer<typeof anamnesisGrantInputSchema>;

export const anamnesisTrainerAccessSchema = z
  .object({
    trainerId: id,
    name: z.string().min(1).max(200),
    email: z.email().max(320),
    markerIds: z.array(anamnesisMarkerSlug),
    documentIds: z.array(id),
  })
  .strict();
export type AnamnesisTrainerAccess = z.infer<
  typeof anamnesisTrainerAccessSchema
>;

export const anamnesisAccessSchema = z
  .object({ trainers: z.array(anamnesisTrainerAccessSchema) })
  .strict();
export type AnamnesisAccess = z.infer<typeof anamnesisAccessSchema>;

export const anamnesisOverviewSchema = z
  .object({
    documents: z.number().int().min(0),
    markers: z.number().int().min(0),
    observations: z.number().int().min(0),
    pendingReviews: z.number().int().min(0),
    activeImports: z.number().int().min(0),
    lastCollectedAt: anamnesisPartialDate.nullable(),
  })
  .strict();
export type AnamnesisOverview = z.infer<typeof anamnesisOverviewSchema>;

export const anamnesisMarkerSummarySchema = z
  .object({
    marker: medicalMarkerSchema,
    observationCount: z.number().int().min(0),
    lastValue: z.string().nullable(),
    lastUnit: z.string().min(1).max(30).nullable(),
    lastCollectedAt: anamnesisPartialDate.nullable(),
    lastReferenceAssessment: z.enum(anamnesisReferenceAssessments).nullable(),
  })
  .strict();
export type AnamnesisMarkerSummary = z.infer<
  typeof anamnesisMarkerSummarySchema
>;

// Корректировка измерения: используется и владельцем, и при подтверждении проверки.
export const medicalObservationCorrectionSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    markerId: anamnesisMarkerSlug.nullable(),
    value: anamnesisObservationValueSchema,
    originalUnit: z.string().min(1).max(30).nullable(),
    collectedAt: anamnesisPartialDate,
    datePrecision: z.enum(anamnesisDatePrecisions),
    referenceRange: medicalReferenceRangeSchema.nullable(),
  })
  .strict()
  .superRefine((correction, ctx) => {
    const shape = correction.collectedAt ?? '';
    const ok =
      correction.datePrecision === 'unknown'
        ? shape === ''
        : correction.datePrecision === 'month'
          ? /^\d{4}-\d{2}$/.test(shape)
          : correction.datePrecision === 'date'
            ? /^\d{4}-\d{2}-\d{2}$/.test(shape)
            : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(shape);
    if (!ok)
      ctx.addIssue({
        code: 'custom',
        path: ['datePrecision'],
        message: 'Точность даты должна соответствовать значению collectedAt',
      });
  });
export type MedicalObservationCorrection = z.infer<
  typeof medicalObservationCorrectionSchema
>;

// Контракт ответа провайдера распознавания: значения как в документе.
export const extractionCandidateSchema = z
  .object({
    name: z.string().min(1).max(300),
    rawText: z.string().min(1).max(2000),
    pageNumber: z.number().int().min(1),
    value: z.string().min(1).max(100),
    comparator: z.enum(anamnesisComparators),
    unit: z.string().min(1).max(30).nullable(),
    collectedAt: z.string().min(1).max(32).nullable(),
    sourceKind: z.enum(anamnesisSourceKinds),
    reference: z
      .object({
        lower: z.string().min(1).max(50).nullable(),
        upper: z.string().min(1).max(50).nullable(),
        lowerInclusive: z.boolean().nullable(),
        upperInclusive: z.boolean().nullable(),
        originalText: z.string().min(1).max(200),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ExtractionCandidate = z.infer<typeof extractionCandidateSchema>;

export const extractionResultSchema = z
  .object({
    laboratory: z.string().min(1).max(200).nullable(),
    title: z.string().min(1).max(300).nullable(),
    issuedAt: z.string().min(1).max(32).nullable(),
    observations: z.array(extractionCandidateSchema).max(500),
  })
  .strict();
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

// Единое отображение значения для клиента и PDF-шаблона.
export function formatAnamnesisValue(
  value:
    | { kind: 'numeric'; value: string; comparator: string }
    | { kind: 'text'; value: string },
): string {
  if (value.kind === 'text') return value.value;
  const sign =
    value.comparator === 'gt'
      ? '> '
      : value.comparator === 'gte'
        ? '≥ '
        : value.comparator === 'lt'
          ? '< '
          : value.comparator === 'lte'
            ? '≤ '
            : '';
  return `${sign}${value.value.replace('.', ',')}`;
}
