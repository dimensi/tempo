import 'server-only';
import { createHash } from 'node:crypto';
import { anamnesisRepository, anamnesisId } from './repository';
import { observationDto } from './dto';
import {
  medicalReportRequestSchema,
  medicalReportCreateSchema,
  medicalObservationDateKey,
  type MedicalReportRequest,
} from '@/contracts/anamnesis';
import { ReportError } from '@/server/pdf/errors';
import { readReportFonts } from '@/server/pdf/fonts';
import {
  prepareMedicalReport,
  renderMedicalPdfReport,
} from './report-renderer';
import type { ObjectStorage } from '@/server/storage';
import { anamnesisReportStorageKey } from './worker';

export { renderMedicalReportHtml, medicalReportCsp } from './report-template';
import { renderMedicalReportHtml } from './report-template';

let active = false;
export async function withMedicalReportSlot<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (active) throw new ReportError('BUSY', 429);
  active = true;
  try {
    return await operation();
  } finally {
    active = false;
  }
}

export interface MedicalReportDeps {
  storage: ObjectStorage;
  render?: typeof renderMedicalPdfReport;
}

// Генерация и сохранение отчёта. Список показателей уже проверен грантами
// вызывающим сервисом; сам отчёт не содержит оригиналов документов.
export async function generateMedicalReport(
  deps: MedicalReportDeps,
  ownerId: string,
  createdBy: string,
  input: unknown,
): Promise<{ id: string; filename: string; sizeBytes: number }> {
  const { snapshotKey, ...request } = medicalReportCreateSchema.parse(input);
  const repo = anamnesisRepository();
  const snapshot = medicalReportSnapshot(ownerId, request);
  if (snapshot.snapshotKey !== snapshotKey)
    throw new ReportError('INVALID', 409);
  const prepared = await prepareMedicalReport(
    await medicalReportSource(request, snapshot.dataset),
  );
  const html = prepared.html;
  const render = deps.render ?? renderMedicalPdfReport;
  const bytes = await render(html);
  if (medicalReportSnapshot(ownerId, request).snapshotKey !== snapshotKey)
    throw new ReportError('INVALID', 409);
  const id = anamnesisId();
  const filename = `anamnesis-${new Date().toISOString().slice(0, 10)}.pdf`;
  await deps.storage.put(
    anamnesisReportStorageKey(id),
    bytes,
    'application/pdf',
  );
  if (medicalReportSnapshot(ownerId, request).snapshotKey !== snapshotKey) {
    await deps.storage.remove(anamnesisReportStorageKey(id));
    throw new ReportError('INVALID', 409);
  }
  const row = repo.insertReport({
    id,
    ownerId,
    createdBy,
    markerIdsJson: request.markerIds,
    dateKeysJson: request.dateKeys,
    historicalPeriodJson: null,
    status: 'ready',
    storageKey: anamnesisReportStorageKey(id),
    filename,
    sizeBytes: bytes.byteLength,
    createdAt: Date.now(),
  });
  return { id: row.id, filename: row.filename, sizeBytes: row.sizeBytes };
}

export function medicalReportSnapshot(ownerId: string, input: unknown) {
  const request = medicalReportRequestSchema.parse(input);
  request.markerIds.sort();
  request.dateKeys =
    request.dateKeys === null ? null : [...new Set(request.dateKeys)].sort();
  const repo = anamnesisRepository();
  const markers = repo
    .listMarkers()
    .filter((marker) => request.markerIds.includes(marker.id));
  if (markers.length !== request.markerIds.length)
    throw new ReportError('INVALID', 422);
  const observations = repo
    .listObservations(ownerId, { markerIds: request.markerIds })
    .map(observationDto)
    .filter(
      (row) =>
        request.dateKeys === null ||
        request.dateKeys.includes(medicalObservationDateKey(row)),
    );
  if (!observations.length) throw new ReportError('NO_DATA', 404);
  const sources = repo
    .listSourcesForObservations(observations.map((row) => row.id))
    .map((source) => ({
      observationId: source.observationId,
      sourceKind: source.sourceKind,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const dataset = markers.map((marker) => ({
    marker,
    observations: observations
      .filter((row) => row.markerId === marker.id)
      .map((row) => ({
        ...row,
        historical:
          sources.some(
            (source) =>
              source.observationId === row.id &&
              source.sourceKind === 'historical_result',
          ) &&
          sources
            .filter((source) => source.observationId === row.id)
            .every((source) => source.sourceKind === 'historical_result'),
      })),
  }));
  const snapshotKey = createHash('sha256')
    .update(JSON.stringify({ version: 2, ownerId, request, dataset, sources }))
    .digest('hex');
  return { dataset, snapshotKey };
}
async function medicalReportSource(
  request: MedicalReportRequest,
  dataset: Parameters<typeof renderMedicalReportHtml>[1],
) {
  const html = renderMedicalReportHtml(
    request,
    dataset,
    await readReportFonts(),
  );
  if (Buffer.byteLength(html) > 4 * 1024 * 1024)
    throw new ReportError('OVERSIZED', 413);
  return html;
}
export async function previewMedicalReport(
  ownerId: string,
  input: unknown,
  signal?: AbortSignal,
) {
  const request = medicalReportRequestSchema.parse(input);
  const snapshot = medicalReportSnapshot(ownerId, request);
  const prepared = await prepareMedicalReport(
    await medicalReportSource(request, snapshot.dataset),
    signal,
  );
  return { ...prepared, snapshotKey: snapshot.snapshotKey };
}
