import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z, ZodError } from 'zod';
import { getDatabase } from '@/server/db';
import { trainerAccess } from '@/server/db/schema';
import { authorize } from '@/server/auth/guards';
import { hasTrustedOrigin } from '@/server/auth/origin';
import { getObjectStorage } from '@/server/storage';
import {
  medicalObservationCorrectionSchema,
  anamnesisGrantInputSchema,
  medicalReportRequestSchema,
  type AnamnesisOverview,
  type AnamnesisMarkerSummary,
  type MedicalDocument,
  type MedicalImportJob,
  type MedicalObservation,
  type MedicalObservationSource,
  type MedicalReportExport,
  type AnamnesisAccess,
} from '@/contracts/anamnesis';
import { ensureAnamnesisCatalog } from './catalog';
import { anamnesisRepository, anamnesisId } from './repository';
import {
  documentDto,
  jobDto,
  observationDto,
  reviewDto,
  revisionDto,
  reportDto,
  sourceDto,
} from './dto';
import {
  AnamnesisUploadError,
  anamnesisUploadLimits,
  validateAnamnesisPdf,
} from './pdf';

export { anamnesisUploadLimits };
import { anamnesisDocumentStorageKey, kickAnamnesisImport } from './worker';
import { generateMedicalReport, withMedicalReportSlot } from './reports';
import {
  assessReference,
  canonicalUnit,
  unitsCanonicallyEqual,
} from './pipeline';

export class AnamnesisError extends Error {
  constructor(public status: number) {
    super('Anamnesis operation failed');
  }
}

type Repo = ReturnType<typeof anamnesisRepository>;
type AuthorizedSession = Extract<
  Awaited<ReturnType<typeof authorize>>,
  { ok: true }
>['session'];

async function check(
  headers: Headers,
  ownerId: string,
  write = false,
): Promise<AuthorizedSession> {
  const result = await authorize(
    headers,
    write ? 'anamnesis:write' : 'anamnesis:read',
    ownerId,
  );
  if (!result.ok) throw new AnamnesisError(result.status);
  if (!z.string().min(1).max(128).safeParse(ownerId).success)
    throw new AnamnesisError(400);
  return result.session;
}

// Владелец видит всё; тренер — только показатели с явным грантом.
async function markerGrants(
  session: AuthorizedSession,
  repo: Repo,
  ownerId: string,
): Promise<Set<string> | null> {
  if (session.user.role !== 'TRAINER') return null;
  return repo.markerGrantIds(ownerId, session.user.id);
}

function requireMarkerAccess(
  grants: Set<string> | null,
  markerId: string | null,
): void {
  if (grants === null) return;
  if (!markerId || !grants.has(markerId)) throw new AnamnesisError(403);
}

// Оригинал PDF выдаётся отдельным грантом — проверка едина для всех мест.
function requireDocumentAccess(
  session: AuthorizedSession,
  repo: Repo,
  ownerId: string,
  documentId: string,
): void {
  if (session.user.role !== 'TRAINER') return;
  const grants = repo.documentGrantIds(ownerId, session.user.id);
  if (!grants.has(documentId)) throw new AnamnesisError(403);
}

// --- Обзор и показатели -------------------------------------------------------

export async function getAnamnesisOverview(
  headers: Headers,
  ownerId: string,
): Promise<AnamnesisOverview> {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  await ensureAnamnesisCatalog();
  const grants = await markerGrants(session, repo, ownerId);
  // Каждая цифра сводки ограничена разрешёнными тренеру данными.
  const documentGrants =
    session.user.role === 'TRAINER'
      ? repo.documentGrantIds(ownerId, session.user.id)
      : null;
  const base = repo.overview(
    ownerId,
    grants === null ? undefined : { markerIds: [...grants] },
    documentGrants === null ? undefined : [...documentGrants],
  );
  const counts = new Map(
    repo
      .markersWithObservations(ownerId)
      .map((row) => [row.markerId, row.count]),
  );
  const visibleMarkers =
    grants === null
      ? [...counts.keys()].filter((markerId) => markerId !== null).length
      : [...counts.keys()].filter(
          (markerId) => markerId !== null && grants.has(markerId),
        ).length;
  return {
    documents: base.documents,
    markers: visibleMarkers,
    observations:
      grants === null
        ? base.observations
        : [...counts.entries()]
            .filter(([markerId]) => markerId !== null && grants.has(markerId))
            .reduce((sum, [, count]) => sum + count, 0),
    pendingReviews: base.pendingReviews,
    activeImports: base.activeImports,
    lastCollectedAt: base.lastCollectedAt,
  };
}

export async function listAnamnesisMarkers(
  headers: Headers,
  ownerId: string,
): Promise<AnamnesisMarkerSummary[]> {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  await ensureAnamnesisCatalog();
  const grants = await markerGrants(session, repo, ownerId);
  const markers = repo.listMarkers();
  const rows = repo.listObservations(ownerId, {});
  return markers
    .map((marker) => {
      const own = rows.filter((row) => row.markerId === marker.id);
      const last = own[own.length - 1] ?? null;
      return {
        marker: {
          id: marker.id,
          code: marker.code,
          name: marker.name,
          shortName: marker.shortName,
          category: marker.category,
          description: marker.description,
          preferredUnit: marker.preferredUnit,
          definitionVersion: marker.definitionVersion,
        },
        observationCount: own.length,
        lastValue: last ? last.valueJson.value : null,
        lastUnit: last?.normalizedUnit ?? last?.originalUnit ?? null,
        lastCollectedAt: last?.collectedAt ?? null,
        lastReferenceAssessment: last?.referenceAssessment ?? null,
      };
    })
    .filter(
      (summary) =>
        summary.observationCount > 0 &&
        (grants === null || grants.has(summary.marker.id)),
    );
}

export async function getAnamnesisMarker(
  headers: Headers,
  ownerId: string,
  markerId: string,
) {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  await ensureAnamnesisCatalog();
  const grants = await markerGrants(session, repo, ownerId);
  requireMarkerAccess(grants, markerId);
  const marker = repo.findMarker(markerId);
  if (!marker) throw new AnamnesisError(404);
  return marker;
}

export async function listMarkerObservations(
  headers: Headers,
  ownerId: string,
  markerId: string,
  period: { from?: string; to?: string } = {},
) {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  const grants = await markerGrants(session, repo, ownerId);
  requireMarkerAccess(grants, markerId);
  const parsed = z
    .object({
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
    })
    .strict()
    .parse(period);
  return repo
    .listObservations(ownerId, { markerIds: [markerId], ...parsed })
    .map(observationDto);
}

// --- Измерения и правки -------------------------------------------------------

export async function getAnamnesisObservation(
  headers: Headers,
  ownerId: string,
  id: string,
) {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  const row = repo.findObservation(ownerId, id);
  if (!row) throw new AnamnesisError(404);
  const grants = await markerGrants(session, repo, ownerId);
  requireMarkerAccess(grants, row.markerId);
  // Грант на показатель не раскрывает оригиналы: тренеру видны цитаты
  // только тех документов, что выданы отдельным грантом.
  const documentGrants =
    session.user.role === 'TRAINER'
      ? repo.documentGrantIds(ownerId, session.user.id)
      : null;
  return {
    observation: observationDto(row),
    sources: repo
      .listSources(id)
      .filter(
        (source) =>
          documentGrants === null || documentGrants.has(source.documentId),
      )
      .map(sourceDto),
  };
}

// История изменений содержит прежние значения, включая данные показателей,
// выданных раньше гранта: только владелец.
export async function listObservationRevisions(
  headers: Headers,
  ownerId: string,
  id: string,
) {
  await check(headers, ownerId, true);
  const repo = anamnesisRepository();
  const row = repo.findObservation(ownerId, id);
  if (!row) throw new AnamnesisError(404);
  return repo.listRevisions(id).map(revisionDto);
}

function fieldChange(
  field: string,
  from: unknown,
  to: unknown,
): { field: string; from: string | null; to: string | null } | null {
  if (from === to) return null;
  const text = (value: unknown) =>
    value === null || value === undefined
      ? null
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return { field, from: text(from), to: text(to) };
}

// Корректировка: optimistic concurrency через expectedRevision, история изменений.
async function correctObservation(
  ownerId: string,
  userId: string,
  repo: Repo,
  id: string,
  input: unknown,
  reason: 'edit' | 'review_confirm',
  resolveReviewId?: string,
): Promise<MedicalObservation> {
  const correction = medicalObservationCorrectionSchema.parse(input);
  const row = repo.findObservation(ownerId, id);
  if (!row) throw new AnamnesisError(404);
  if (correction.markerId && !repo.findMarker(correction.markerId))
    throw new AnamnesisError(400);
  if (row.revision !== correction.expectedRevision)
    throw new AnamnesisError(409);
  const nextValue = correction.value;
  const nextRange = correction.referenceRange;
  // Нормализация пересчитывается по новым данным: старые normalized-поля
  // не переживают правку значения, единицы или показателя.
  const canonical = canonicalUnit(correction.originalUnit);
  const preferred = correction.markerId
    ? (repo.findMarker(correction.markerId)?.preferredUnit ?? null)
    : null;
  const normalizedValue =
    nextValue.kind === 'numeric' && canonical ? nextValue.value : null;
  const normalizedUnit =
    normalizedValue !== null &&
    canonical !== null &&
    preferred !== null &&
    unitsCanonicallyEqual(canonical, preferred)
      ? preferred
      : canonical;
  const updated = getDatabase().sqlite.transaction(() => {
    const assessment = assessReference(nextValue, nextRange);
    const saved = repo.updateObservation(
      ownerId,
      id,
      correction.expectedRevision,
      {
        markerId: correction.markerId,
        valueJson: nextValue,
        originalUnit: correction.originalUnit,
        normalizedValue,
        normalizedUnit,
        collectedAt: correction.collectedAt,
        datePrecision: correction.datePrecision,
        referenceJson: nextRange,
        referenceAssessment: assessment,
        verification: 'user_verified',
      },
    );
    if (!saved) throw new AnamnesisError(409);
    const changes = [
      fieldChange('markerId', row.markerId, correction.markerId),
      fieldChange('value', row.valueJson, nextValue),
      fieldChange('originalUnit', row.originalUnit, correction.originalUnit),
      fieldChange('collectedAt', row.collectedAt, correction.collectedAt),
      fieldChange('datePrecision', row.datePrecision, correction.datePrecision),
      fieldChange('referenceRange', row.referenceJson, nextRange),
    ].filter((change): change is NonNullable<typeof change> => change !== null);
    if (changes.length)
      repo.insertRevision({
        id: anamnesisId(),
        observationId: id,
        changedBy: userId,
        reason,
        changesJson: changes,
        createdAt: Date.now(),
      });
    // Подтверждение проверки атомарно с правкой: половинные состояния исключены.
    if (
      resolveReviewId &&
      !repo.resolveReview(resolveReviewId, 'resolved', userId)
    )
      throw new AnamnesisError(409);
    return saved;
  })();
  return observationDto(updated);
}

export async function correctAnamnesisObservation(
  headers: Headers,
  ownerId: string,
  id: string,
  input: unknown,
): Promise<MedicalObservation> {
  const session = await check(headers, ownerId, true);
  return correctObservation(
    ownerId,
    session.user.id,
    anamnesisRepository(),
    id,
    input,
    'edit',
  );
}

// --- Документы -----------------------------------------------------------------

export async function listAnamnesisDocuments(
  headers: Headers,
  ownerId: string,
): Promise<MedicalDocument[]> {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  const rows = repo.listDocuments(ownerId);
  if (session.user.role !== 'TRAINER') return rows.map(documentDto);
  const grants = repo.documentGrantIds(ownerId, session.user.id);
  return rows.filter((row) => grants.has(row.id)).map(documentDto);
}

export async function getAnamnesisDocument(
  headers: Headers,
  ownerId: string,
  id: string,
): Promise<MedicalDocument> {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  const row = repo.findDocument(ownerId, id);
  if (!row) throw new AnamnesisError(404);
  requireDocumentAccess(session, repo, ownerId, id);
  return documentDto(row);
}

// Измерения документа с происхождением; для тренера — по гранту документа.
export async function listAnamnesisDocumentObservations(
  headers: Headers,
  ownerId: string,
  documentId: string,
): Promise<
  Array<{
    observation: MedicalObservation;
    sources: MedicalObservationSource[];
  }>
> {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  const document = repo.findDocument(ownerId, documentId);
  if (!document) throw new AnamnesisError(404);
  requireDocumentAccess(session, repo, ownerId, documentId);
  const observations = repo.listObservationsByDocument(ownerId, documentId);
  const sources = repo.listSourcesForObservations(
    observations.map((row) => row.id),
  );
  // Измерение могло дедуплицироваться между документами: раскрываем только
  // источники запрошенного документа, чужие цитаты не покидают сервер.
  return observations.map((observation) => ({
    observation: observationDto(observation),
    sources: sources
      .filter(
        (source) =>
          source.observationId === observation.id &&
          source.documentId === documentId,
      )
      .map(sourceDto),
  }));
}

// Скачивание оригинала: доступ к PDF выдаётся отдельно от показателей.
export async function getAnamnesisDocumentFile(
  headers: Headers,
  ownerId: string,
  id: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  const row = repo.findDocument(ownerId, id);
  if (!row) throw new AnamnesisError(404);
  requireDocumentAccess(session, repo, ownerId, id);
  const bytes = await getObjectStorage().get(row.storageKey);
  return { bytes, filename: row.filename };
}

export async function uploadAnamnesisDocument(
  headers: Headers,
  ownerId: string,
  input: { filename: string; bytes: Uint8Array },
): Promise<{
  document: MedicalDocument;
  importJob: MedicalImportJob | null;
  duplicate: boolean;
}> {
  await check(headers, ownerId, true);
  const filename = z
    .string()
    .min(1)
    .max(255)
    .parse(
      input.filename.replace(/[\\/\u0000-\u001f]/g, '').trim() ||
        'document.pdf',
    );
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const repo = anamnesisRepository();
  const existing = repo.findDocumentBySha(ownerId, sha256);
  if (existing)
    return {
      document: documentDto(existing),
      importJob: null,
      duplicate: true,
    };
  const pageCount = await validateAnamnesisPdfGuarded(input.bytes);
  const now = Date.now();
  const storageKey = anamnesisDocumentStorageKey(ownerId, sha256);
  // Объект записывается первым: контентно-адресуемый ключ делает «осиротевший»
  // объект безвредным, а строки без объекта — нет.
  await getObjectStorage().put(storageKey, input.bytes, 'application/pdf');
  let document;
  let job;
  try {
    getDatabase().sqlite.transaction(() => {
      document = repo.insertDocument({
        id: anamnesisId(),
        ownerId,
        filename,
        storageKey,
        sha256,
        mimeType: 'application/pdf',
        sizeBytes: input.bytes.byteLength,
        pageCount,
        laboratoryName: null,
        title: null,
        collectedAt: null,
        issuedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      job = repo.insertJob({
        id: anamnesisId(),
        ownerId,
        documentId: document.id,
        status: 'queued',
        stage: 'upload_validation',
        attempts: 0,
        lastError: null,
        leaseUntil: null,
        createdAt: now,
        updatedAt: now,
      });
    })();
  } catch (error) {
    // Гонка одинаковых загрузок: победил параллельный запрос.
    const winner = repo.findDocumentBySha(ownerId, sha256);
    if ((error as Error).message?.includes('UNIQUE') && winner)
      return {
        document: documentDto(winner),
        importJob: null,
        duplicate: true,
      };
    throw error;
  }
  if (!document || !job) throw new AnamnesisError(500);
  kickAnamnesisImport();
  return {
    document: documentDto(document),
    importJob: jobDto(job),
    duplicate: false,
  };
}

async function validateAnamnesisPdfGuarded(bytes: Uint8Array): Promise<number> {
  try {
    // pdfjs может забрать владение буфером: проверяем копию, оригинал
    // уходит в хранилище и метаданные нетронутым.
    return await validateAnamnesisPdf(bytes.slice(), anamnesisUploadLimits());
  } catch (error) {
    if (error instanceof AnamnesisUploadError)
      throw new AnamnesisError(
        error.issue === 'TOO_LARGE'
          ? 413
          : error.issue === 'TOO_MANY_PAGES'
            ? 413
            : 400,
      );
    throw error;
  }
}

export async function deleteAnamnesisDocument(
  headers: Headers,
  ownerId: string,
  id: string,
): Promise<void> {
  await check(headers, ownerId, true);
  const repo = anamnesisRepository();
  if (!repo.softDeleteDocument(ownerId, id)) throw new AnamnesisError(404);
}

export async function reprocessAnamnesisDocument(
  headers: Headers,
  ownerId: string,
  id: string,
): Promise<MedicalImportJob> {
  await check(headers, ownerId, true);
  const repo = anamnesisRepository();
  const document = repo.findDocument(ownerId, id);
  if (!document) throw new AnamnesisError(404);
  const now = Date.now();
  repo.deleteImportedObservations(id);
  const job = repo.insertJob({
    id: anamnesisId(),
    ownerId,
    documentId: id,
    status: 'queued',
    stage: 'upload_validation',
    attempts: 0,
    lastError: null,
    leaseUntil: null,
    createdAt: now,
    updatedAt: now,
  });
  kickAnamnesisImport();
  return jobDto(job);
}

// --- Импорт ----------------------------------------------------------------------

export async function listAnamnesisImports(
  headers: Headers,
  ownerId: string,
): Promise<MedicalImportJob[]> {
  const session = await check(headers, ownerId);
  // Опрос очереди оживляет обработку после перезапуска процесса —
  // состояние заданий живёт в базе, а не в памяти.
  kickAnamnesisImport();
  const repo = anamnesisRepository();
  const rows = repo.listJobs(ownerId);
  if (session.user.role !== 'TRAINER') return rows.map(jobDto);
  const grants = repo.documentGrantIds(ownerId, session.user.id);
  return rows.filter((row) => grants.has(row.documentId)).map(jobDto);
}

export async function getAnamnesisImport(
  headers: Headers,
  ownerId: string,
  id: string,
): Promise<MedicalImportJob> {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  const job = repo.findJob(ownerId, id);
  if (!job) throw new AnamnesisError(404);
  requireDocumentAccess(session, repo, ownerId, job.documentId);
  return jobDto(job);
}

// --- Очередь проверки -------------------------------------------------------------

// Очередь проверки с цитатами источников — только владелец.
export async function listAnamnesisReviews(headers: Headers, ownerId: string) {
  await check(headers, ownerId, true);
  const repo = anamnesisRepository();
  const reviews = repo.listPendingReviews(ownerId);
  const observations = repo
    .listSourcesForObservations(reviews.map((review) => review.observationId))
    .reduce<Map<string, ReturnType<Repo['listSources']>>>((map, source) => {
      const list = map.get(source.observationId) ?? [];
      list.push(source);
      map.set(source.observationId, list);
      return map;
    }, new Map());
  return reviews.map((review) => ({
    review: reviewDto(review),
    observation: observationDto(repo.findObservationAny(review.observationId)!),
    sources: (observations.get(review.observationId) ?? []).map(sourceDto),
  }));
}

// Тренеру виден только счётчик проверок по разрешённым показателям.
export async function countAnamnesisReviews(headers: Headers, ownerId: string) {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  const grants = await markerGrants(session, repo, ownerId);
  return grants === null
    ? repo.countPendingReviews(ownerId)
    : repo.countPendingReviews(ownerId, [...grants]);
}

export async function confirmAnamnesisReview(
  headers: Headers,
  ownerId: string,
  id: string,
  input: unknown,
): Promise<MedicalObservation> {
  const session = await check(headers, ownerId, true);
  const repo = anamnesisRepository();
  const review = repo.findReview(ownerId, id);
  if (!review || review.status !== 'pending') throw new AnamnesisError(404);
  return correctObservation(
    ownerId,
    session.user.id,
    repo,
    review.observationId,
    input,
    'review_confirm',
    id,
  );
}

export async function rejectAnamnesisReview(
  headers: Headers,
  ownerId: string,
  id: string,
): Promise<void> {
  const session = await check(headers, ownerId, true);
  const repo = anamnesisRepository();
  const review = repo.findReview(ownerId, id);
  if (!review || review.status !== 'pending') throw new AnamnesisError(404);
  const row = repo.findObservationAny(review.observationId);
  if (!row) throw new AnamnesisError(404);
  getDatabase().sqlite.transaction(() => {
    const saved = repo.updateObservation(ownerId, row.id, row.revision, {
      verification: 'rejected',
    });
    if (!saved) throw new AnamnesisError(409);
    repo.insertRevision({
      id: anamnesisId(),
      observationId: row.id,
      changedBy: session.user.id,
      reason: 'review_reject',
      changesJson: [
        {
          field: 'verification',
          from: row.verification,
          to: 'rejected',
        },
      ],
      createdAt: Date.now(),
    });
    if (!repo.resolveReview(id, 'rejected', session.user.id))
      throw new AnamnesisError(409);
  })();
}

// --- Управление доступом тренера ----------------------------------------------

export async function getAnamnesisAccess(
  headers: Headers,
  ownerId: string,
): Promise<AnamnesisAccess> {
  await check(headers, ownerId, true);
  const repo = anamnesisRepository();
  await ensureAnamnesisCatalog();
  const trainers = repo.listGrantTrainers(ownerId);
  return {
    trainers: trainers.map((trainer) => ({
      trainerId: trainer.trainerId,
      name: trainer.name,
      email: trainer.email,
      markerIds: [...repo.markerGrantIds(ownerId, trainer.trainerId)],
      documentIds: [...repo.documentGrantIds(ownerId, trainer.trainerId)],
    })),
  };
}

async function grantTargetTrainer(
  ownerId: string,
  trainerId: string,
): Promise<void> {
  const grant = getDatabase()
    .db.select({ ownerId: trainerAccess.ownerId })
    .from(trainerAccess)
    .where(
      and(
        eq(trainerAccess.trainerId, trainerId),
        eq(trainerAccess.ownerId, ownerId),
      ),
    )
    .get();
  if (!grant) throw new AnamnesisError(400);
}

export async function setAnamnesisMarkerGrant(
  headers: Headers,
  ownerId: string,
  markerId: string,
  input: unknown,
): Promise<void> {
  await check(headers, ownerId, true);
  const parsed = anamnesisGrantInputSchema.parse(input);
  const repo = anamnesisRepository();
  await ensureAnamnesisCatalog();
  if (!repo.findMarker(markerId)) throw new AnamnesisError(404);
  await grantTargetTrainer(ownerId, parsed.trainerId);
  repo.setMarkerGrant(ownerId, parsed.trainerId, markerId, parsed.enabled);
}

export async function setAnamnesisDocumentGrant(
  headers: Headers,
  ownerId: string,
  documentId: string,
  input: unknown,
): Promise<void> {
  await check(headers, ownerId, true);
  const parsed = anamnesisGrantInputSchema.parse(input);
  const repo = anamnesisRepository();
  if (!repo.findDocument(ownerId, documentId)) throw new AnamnesisError(404);
  await grantTargetTrainer(ownerId, parsed.trainerId);
  repo.setDocumentGrant(ownerId, parsed.trainerId, documentId, parsed.enabled);
}

// --- Отчёты -----------------------------------------------------------------------

export async function createAnamnesisReport(
  headers: Headers,
  ownerId: string,
  input: unknown,
): Promise<{ id: string; filename: string; sizeBytes: number }> {
  const access = await authorize(headers, 'anamnesis:report', ownerId);
  if (!access.ok) throw new AnamnesisError(access.status);
  const session = access.session;
  const repo = anamnesisRepository();
  const request = medicalReportRequestSchema.parse(input);
  // Тренер строит отчёт только из разрешённых показателей.
  if (session.user.role === 'TRAINER') {
    const grants = repo.markerGrantIds(ownerId, session.user.id);
    if (request.markerIds.some((markerId) => !grants.has(markerId)))
      throw new AnamnesisError(403);
  }
  try {
    return await withMedicalReportSlot(() =>
      generateMedicalReport(
        { storage: getObjectStorage() },
        ownerId,
        session.user.id,
        input,
      ),
    );
  } catch (error) {
    if (error instanceof ZodError) throw new AnamnesisError(400);
    throw error;
  }
}

function reportVisibleToGrants(
  grants: Set<string> | null,
  report: { markerIds: string[] },
): boolean {
  if (grants === null) return true;
  return report.markerIds.every((markerId) => grants.has(markerId));
}

export async function listAnamnesisReports(
  headers: Headers,
  ownerId: string,
): Promise<MedicalReportExport[]> {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  const grants = await markerGrants(session, repo, ownerId);
  return repo
    .listReports(ownerId)
    .map(reportDto)
    .filter((report) => reportVisibleToGrants(grants, report));
}

// Скачивание перепроверяет гранты: отозванное разрешение блокирует и файл.
export async function getAnamnesisReportFile(
  headers: Headers,
  ownerId: string,
  id: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const session = await check(headers, ownerId);
  const repo = anamnesisRepository();
  const row = repo.findReport(ownerId, id);
  if (!row || row.status !== 'ready' || !row.storageKey)
    throw new AnamnesisError(404);
  const grants = await markerGrants(session, repo, ownerId);
  if (!reportVisibleToGrants(grants, reportDto(row)))
    throw new AnamnesisError(403);
  const bytes = await getObjectStorage().get(row.storageKey);
  return { bytes, filename: row.filename };
}

export async function deleteAnamnesisReport(
  headers: Headers,
  ownerId: string,
  id: string,
): Promise<void> {
  await check(headers, ownerId, true);
  const repo = anamnesisRepository();
  const row = repo.findReport(ownerId, id);
  if (!repo.deleteReport(ownerId, id)) throw new AnamnesisError(404);
  if (row?.storageKey) await getObjectStorage().remove(row.storageKey);
}

export function checkAnamnesisOrigin(request: Request): void {
  if (!hasTrustedOrigin(request)) throw new AnamnesisError(403);
}

export function anamnesisErrorResponse(error: unknown): Response {
  return Response.json(
    { error: 'Не удалось выполнить операцию с анамнезом' },
    {
      status:
        error instanceof AnamnesisError
          ? error.status
          : error instanceof SyntaxError || error instanceof ZodError
            ? 400
            : 500,
    },
  );
}
