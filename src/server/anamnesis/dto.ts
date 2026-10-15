import 'server-only';
import type {
  MedicalDocument,
  MedicalImportJob,
  MedicalObservation,
  MedicalObservationSource,
  MedicalReviewItem,
  MedicalObservationRevision,
  MedicalReportExport,
} from '@/contracts/anamnesis';
import type {
  MedicalDocumentRow,
  MedicalImportJobRow,
  MedicalObservationRow,
  MedicalObservationSourceRow,
  MedicalReviewItemRow,
  MedicalObservationRevisionRow,
  MedicalReportExportRow,
} from './repository';

export function documentDto(row: MedicalDocumentRow): MedicalDocument {
  return {
    id: row.id,
    ownerId: row.ownerId,
    filename: row.filename,
    mimeType: 'application/pdf',
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    laboratoryName: row.laboratoryName,
    title: row.title,
    collectedAt: row.collectedAt,
    issuedAt: row.issuedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function jobDto(row: MedicalImportJobRow): MedicalImportJob {
  return {
    id: row.id,
    ownerId: row.ownerId,
    documentId: row.documentId,
    status: row.status,
    stage: row.stage,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function observationDto(row: MedicalObservationRow): MedicalObservation {
  return {
    id: row.id,
    ownerId: row.ownerId,
    markerId: row.markerId,
    originalName: row.originalName,
    value: row.valueJson,
    originalUnit: row.originalUnit,
    normalizedValue: row.normalizedValue,
    normalizedUnit: row.normalizedUnit,
    collectedAt: row.collectedAt,
    datePrecision: row.datePrecision,
    laboratoryName: row.laboratoryName,
    referenceRange: row.referenceJson,
    referenceAssessment: row.referenceAssessment,
    verification: row.verification,
    extractionVersion: row.extractionVersion,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function sourceDto(
  row: MedicalObservationSourceRow,
): MedicalObservationSource {
  return {
    id: row.id,
    observationId: row.observationId,
    documentId: row.documentId,
    pageNumber: row.pageNumber,
    sourceKind: row.sourceKind,
    rawText: row.rawText,
    boundingBox: row.boundingBoxJson,
    extractionConfidence: row.extractionConfidence,
  };
}

export function reviewDto(row: MedicalReviewItemRow): MedicalReviewItem {
  return {
    id: row.id,
    ownerId: row.ownerId,
    observationId: row.observationId,
    documentId: row.documentId,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
  };
}

export function revisionDto(
  row: MedicalObservationRevisionRow,
): MedicalObservationRevision {
  return {
    id: row.id,
    observationId: row.observationId,
    changedBy: row.changedBy,
    reason: row.reason,
    changes: row.changesJson,
    createdAt: row.createdAt,
  };
}

export function reportDto(row: MedicalReportExportRow): MedicalReportExport {
  return {
    id: row.id,
    ownerId: row.ownerId,
    createdBy: row.createdBy,
    markerIds: row.markerIdsJson,
    dateKeys: row.dateKeysJson,
    historicalPeriod: row.historicalPeriodJson,
    status: row.status,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  };
}
