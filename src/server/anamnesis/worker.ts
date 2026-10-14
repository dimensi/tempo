import 'server-only';
import { getDatabase } from '@/server/db';
import {
  getObjectStorage,
  storageNamespaceKey,
  type ObjectStorage,
} from '@/server/storage';
import { anamnesisRepository, anamnesisId } from './repository';
import { analyzeAnamnesisPdf, type PdfPageAnalysis } from './pdf';
import { ensureAnamnesisCatalog } from './catalog';
import { buildCatalogIndex } from './markers';
import {
  anamnesisExtractionProvider,
  AnamnesisProviderError,
  type AnamnesisExtractionProvider,
  type ExtractionRequestPage,
} from './providers';
import {
  prepareCandidate,
  groupDuplicateCandidates,
  parseCollectedAt,
  unitsCanonicallyEqual,
  type PreparedCandidate,
} from './pipeline';
import { normalizeSourceKinds } from './extraction-normalize';

export const ANAMNESIS_EXTRACTION_VERSION = '1';
const LEASE_MS = 300000;
const MAX_ATTEMPTS = 3;

export interface AnamnesisWorkerDeps {
  database: ReturnType<typeof getDatabase>;
  storage: ObjectStorage;
  provider: AnamnesisExtractionProvider;
  now?: () => number;
}

export function createAnamnesisWorker(deps: AnamnesisWorkerDeps) {
  const repo = anamnesisRepository(deps.database.db);
  const now = deps.now ?? Date.now;

  async function stillOurs(jobId: string): Promise<boolean> {
    const current = repo.findJobById(jobId);
    return current?.status === 'processing';
  }

  async function processJob(jobId: string): Promise<void> {
    const job = repo.findJobById(jobId);
    if (!job || job.status !== 'processing') return;
    const document = repo.findDocument(job.ownerId, job.documentId);
    if (!document || document.deletedAt !== null) {
      repo.updateJob(jobId, {
        status: 'failed',
        lastError: 'DOCUMENT_MISSING',
      });
      return;
    }
    try {
      const bytes = await deps.storage.get(document.storageKey);
      if (!(await stillOurs(jobId))) return;

      repo.updateJob(jobId, { stage: 'pdf_extraction' });
      const pages = await analyzeAnamnesisPdf(bytes);
      if (!(await stillOurs(jobId))) return;

      repo.updateJob(jobId, { stage: 'ocr' });
      const requestPages: ExtractionRequestPage[] = pages.map((page) => ({
        pageNumber: page.pageNumber,
        lines: page.lines,
        imageJpeg: page.hasTextLayer ? null : page.imageJpeg,
      }));
      const unrecognizedPages = requestPages.filter(
        (page) => !page.lines.length && !page.imageJpeg,
      ).length;

      repo.updateJob(jobId, { stage: 'structured_extraction' });
      const { result: extraction, forcedReviewIndexes } = normalizeSourceKinds(
        await deps.provider.extract({
          sha256: document.sha256,
          pages: requestPages,
        }),
      );
      if (!(await stillOurs(jobId))) return;

      repo.updateJob(jobId, { stage: 'normalization' });
      await ensureAnamnesisCatalog(deps.database);
      const aliases = repo.listAliases();
      const index = buildCatalogIndex(
        aliases.map((row) => ({ markerId: row.markerId, alias: row.alias })),
      );
      const preferredUnits = new Map(
        repo.listMarkers().map((marker) => [marker.id, marker.preferredUnit]),
      );
      const prepared = extraction.observations.map((candidate, position) => {
        const item = prepareCandidate(candidate, index, preferredUnits);
        // Роль результата не распознана — обязательное условие нарушено.
        if (forcedReviewIndexes.includes(position))
          return {
            ...item,
            reviewReason: 'unknown_source_kind' as const,
            autoVerifiable: false,
          };
        return item;
      });

      repo.updateJob(jobId, { stage: 'validation' });
      const groups = groupDuplicateCandidates(prepared);
      const warnings = { reviews: 0, unrecognizedPages };
      const issuedAt = parseCollectedAt(extraction.issuedAt).collectedAt;
      const laboratoryName = extraction.laboratory;

      repo.updateJob(jobId, { stage: 'persistence' });
      const createdAt = now();
      deps.database.sqlite.transaction(() => {
        repo.replacePages(
          document.id,
          pages.map((page) => ({
            id: anamnesisId(),
            documentId: document.id,
            pageNumber: page.pageNumber,
            width: page.width,
            height: page.height,
            hasTextLayer: page.hasTextLayer,
            textJson: { lines: page.lines.slice(0, 400) },
            ocrApplied: !page.hasTextLayer && page.imageJpeg !== null,
          })),
        );
        for (const group of groups) {
          const inserted = persistGroup(group, {
            ownerId: job.ownerId,
            documentId: document.id,
            createdAt,
            laboratoryName,
            pages,
          });
          if (inserted === 'review') warnings.reviews++;
        }
        const documentDates = [
          ...new Set(
            extraction.observations
              .filter((item) => item.sourceKind === 'current_result')
              .map((item) => parseCollectedAt(item.collectedAt).collectedAt)
              .filter((value): value is string => value !== null),
          ),
        ];
        repo.updateDocument(job.ownerId, document.id, {
          laboratoryName: extraction.laboratory,
          title: extraction.title,
          collectedAt: documentDates.length === 1 ? documentDates[0]! : null,
          issuedAt,
        });
        repo.updateJob(jobId, {
          status:
            warnings.reviews > 0 || warnings.unrecognizedPages > 0
              ? 'completed_with_warnings'
              : 'completed',
          stage: 'persistence',
          leaseUntil: null,
          lastError: null,
        });
      })();
    } catch (error) {
      failJob(jobId, error);
    }
  }

  // Создаёт измерение из группы дублей и его источники. Обращения к БД
  // выполняются только внутри транзакции вызывающей стороны.
  function persistGroup(
    group: PreparedCandidate[],
    ctx: {
      ownerId: string;
      documentId: string;
      createdAt: number;
      laboratoryName: string | null;
      pages: PdfPageAnalysis[];
    },
  ): 'inserted' | 'merged' | 'review' {
    const primary = group[0]!;
    const sourceRows = (observationId: string) =>
      group.map((item) => ({
        id: anamnesisId(),
        observationId,
        documentId: ctx.documentId,
        pageNumber: item.candidate.pageNumber,
        sourceKind: item.candidate.sourceKind,
        rawText: item.candidate.rawText,
        boundingBoxJson: locateBoundingBox(
          ctx.pages.find(
            (page) => page.pageNumber === item.candidate.pageNumber,
          ) ?? null,
          item,
        ),
        extractionConfidence: null,
      }));

    // Причина проверки проверяется по всей группе: нераспознанная роль у
    // любого повтора страницы переводит группу в ручную проверку.
    let reason =
      primary.reviewReason ??
      group.map((item) => item.reviewReason).find(Boolean) ??
      null;
    if (
      !reason &&
      primary.autoVerifiable &&
      primary.markerId &&
      primary.collectedAt &&
      primary.value
    ) {
      const exact = repo.findExactObservation(ctx.ownerId, {
        markerId: primary.markerId,
        collectedAt: primary.collectedAt,
        value: primary.value,
        originalUnit: primary.originalUnit,
        laboratoryName: ctx.laboratoryName,
      });
      if (exact) {
        repo.insertSources(sourceRows(exact.id));
        return 'merged';
      }
      {
        // В тот же день по этому показателю уже есть записи: другое значение —
        // противоречие; то же значение при другой лаборатории или единице —
        // совпадение не доказано, возможный дубль.
        // Сравнение симметрично точности дат: день кандидата покрывает
        // сохранённые месяц/дату, и наоборот.
        const sameDay = repo
          .findObservationsByMarkerAndDay(
            ctx.ownerId,
            primary.markerId,
            primary.collectedAt.slice(0, 10),
          )
          .filter((row) => {
            const candidateDay = primary.collectedAt ?? '';
            const stored = row.collectedAt ?? '';
            return (
              candidateDay.startsWith(stored) || stored.startsWith(candidateDay)
            );
          });
        const sameValue = sameDay.filter(
          (row) =>
            row.valueJson.kind === primary.value?.kind &&
            (row.valueJson.kind !== 'numeric' ||
              row.valueJson.value === primary.value?.value),
        );
        if (sameDay.length > sameValue.length) reason = 'contradiction';
        else if (
          sameValue.some((row) => {
            // Канонически равные единицы (нг/мл и ng/ml) дублем не считаются.
            const sameUnit =
              (row.originalUnit ?? null) === (primary.originalUnit ?? null) ||
              (row.originalUnit !== null &&
                primary.originalUnit !== null &&
                unitsCanonicallyEqual(row.originalUnit, primary.originalUnit));
            return (
              !sameUnit ||
              (row.laboratoryName ?? null) !== (ctx.laboratoryName ?? null)
            );
          })
        )
          reason = 'possible_duplicate';
      }
    }
    const observationId = anamnesisId();
    const verification = reason ? 'needs_review' : 'auto_verified';
    repo.insertObservation({
      id: observationId,
      ownerId: ctx.ownerId,
      markerId: primary.markerId,
      originalName: primary.candidate.name,
      valueJson: primary.value ?? {
        kind: 'text',
        value: primary.candidate.value.slice(0, 500),
      },
      originalUnit: primary.originalUnit,
      normalizedValue: primary.normalizedValue,
      normalizedUnit: primary.normalizedUnit,
      collectedAt: primary.collectedAt,
      datePrecision: primary.datePrecision,
      laboratoryName: ctx.laboratoryName,
      referenceJson: primary.referenceRange,
      referenceAssessment: primary.referenceAssessment,
      verification,
      extractionVersion: ANAMNESIS_EXTRACTION_VERSION,
      revision: 1,
      createdAt: ctx.createdAt,
      updatedAt: ctx.createdAt,
    });
    repo.insertSources(sourceRows(observationId));
    if (reason)
      repo.insertReview({
        id: anamnesisId(),
        ownerId: ctx.ownerId,
        observationId,
        documentId: ctx.documentId,
        reason,
        status: 'pending',
        createdAt: ctx.createdAt,
        resolvedAt: null,
        resolvedBy: null,
      });
    return reason ? 'review' : 'inserted';
  }

  function failJob(jobId: string, error: unknown) {
    const job = repo.findJobById(jobId);
    if (!job || job.status !== 'processing') return;
    if (
      error instanceof AnamnesisProviderError &&
      error.transient &&
      job.attempts < MAX_ATTEMPTS
    ) {
      repo.updateJob(jobId, {
        status: 'queued',
        leaseUntil: null,
        lastError: error.code,
      });
      return;
    }
    // Технические причины без персональных данных.
    const code =
      error instanceof AnamnesisProviderError
        ? error.code
        : error instanceof Error
          ? 'PIPELINE_ERROR'
          : 'UNKNOWN';
    repo.updateJob(jobId, {
      status: 'failed',
      leaseUntil: null,
      lastError: code,
    });
  }

  function locateBoundingBox(
    page: PdfPageAnalysis | null,
    item: PreparedCandidate,
  ): { x: number; y: number; width: number; height: number } | null {
    if (
      !page ||
      !page.hasTextLayer ||
      !item.value ||
      item.value.kind !== 'numeric'
    )
      return null;
    const needle = item.value.value.replace('.', ',');
    const match = page.items.find((candidate) =>
      candidate.text.includes(needle),
    );
    return match
      ? { x: match.x, y: match.y, width: match.width, height: match.height }
      : null;
  }

  return {
    processJob,
    runQueue: async (): Promise<number> => {
      let processed = 0;
      for (;;) {
        const job = repo.claimNextJob(now() + LEASE_MS, MAX_ATTEMPTS);
        if (!job) break;
        await processJob(job.id);
        processed++;
      }
      return processed;
    },
  };
}

let active: Promise<void> | null = null;

// Фоновая обработка после загрузки; один воркер на процесс.
export function kickAnamnesisImport(): void {
  if (active) return;
  active = (async () => {
    try {
      await createAnamnesisWorker(defaultDeps()).runQueue();
    } catch {
      // Сбои отдельных заданий фиксируются в самой очереди.
    } finally {
      active = null;
    }
  })();
}

export function defaultDeps(): AnamnesisWorkerDeps {
  return {
    database: getDatabase(),
    storage: getObjectStorage(),
    provider: anamnesisExtractionProvider(),
  };
}

export const anamnesisDocumentStorageKey = (ownerId: string, sha256: string) =>
  storageNamespaceKey('anamnesis', ownerId, `${sha256}.pdf`);
export const anamnesisReportStorageKey = (id: string) =>
  storageNamespaceKey('anamnesis', 'reports', `${id}.pdf`);

// Периодический проход по очереди для продакшена (instrumentation).
export function startAnamnesisWorkerLoop(
  intervalMs = 30000,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => kickAnamnesisImport(), intervalMs);
  timer.unref?.();
  return timer;
}
