import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

vi.mock('server-only', () => ({}));

const { openDatabase } = await import('@/server/db/connection');
const { fsObjectStorage } = await import('@/server/storage/fs');
const { createAnamnesisWorker } = await import('@/server/anamnesis/worker');
const { fixtureExtractionResult } =
  await import('@/server/anamnesis/providers');
const { ensureAnamnesisCatalog } = await import('@/server/anamnesis/catalog');
const { anamnesisRepository } = await import('@/server/anamnesis/repository');
const { user } = await import('@/server/db/schema');

const database = openDatabase('file::memory:');
const repo = anamnesisRepository(database.db);
const storageRoot = mkdtempSync(join(tmpdir(), 'anamnesis-worker-'));

const worker = createAnamnesisWorker({
  database,
  storage: fsObjectStorage({ rootDir: storageRoot }),
  provider: {
    name: 'fixture',
    extract: async () => fixtureExtractionResult(),
  },
});

beforeAll(async () => {
  await migrate(database.db, { migrationsFolder: './drizzle' });
  const now = Date.now();
  database.db
    .insert(user)
    .values({
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.test',
      emailVerified: true,
      createdAt: new Date(now),
      updatedAt: new Date(now),
      role: 'OWNER',
    })
    .run();
  await ensureAnamnesisCatalog(database);

  const bytes = new Uint8Array(
    readFileSync('tests/fixtures/anamnesis/synthetic-lab.pdf'),
  );
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await createSetup(bytes, sha256, now);
});

async function createSetup(bytes: Uint8Array, sha256: string, now: number) {
  const storage = fsObjectStorage({ rootDir: storageRoot });
  await storage.put(`anamnesis/owner/${sha256}.pdf`, bytes);
  repo.insertDocument({
    id: 'document-1',
    ownerId: 'owner',
    filename: 'synthetic-lab.pdf',
    storageKey: `anamnesis/owner/${sha256}.pdf`,
    sha256,
    mimeType: 'application/pdf',
    sizeBytes: bytes.byteLength,
    pageCount: 3,
    laboratoryName: null,
    title: null,
    collectedAt: null,
    issuedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  repo.insertJob({
    id: 'job-1',
    ownerId: 'owner',
    documentId: 'document-1',
    status: 'queued',
    stage: 'upload_validation',
    attempts: 0,
    lastError: null,
    leaseUntil: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe('anamnesis import worker on the reference PDF', () => {
  // Полный разбор трёх сканов реального PDF: тяжёлая работа, отдельный таймаут.
  it(
    'imports the reference document exactly once, without duplicates',
    { timeout: 30000 },
    async () => {
      const processed = await worker.runQueue();
      expect(processed).toBe(1);

      const job = repo.findJobById('job-1')!;
      expect(job.status).toBe('completed');

      const observations = repo.listObservations('owner', {});
      // ТЗ §9: шесть измерений, пять показателей.
      expect(observations).toHaveLength(6);
      expect(new Set(observations.map((row) => row.markerId))).toEqual(
        new Set([
          'vitamin-d-25oh',
          'alt',
          'ast',
          'pancreatic-amylase',
          'total-bilirubin',
        ]),
      );
      expect(
        observations.every((row) => row.verification === 'auto_verified'),
      ).toBe(true);

      const vitaminD = observations.filter(
        (row) => row.markerId === 'vitamin-d-25oh',
      );
      expect(vitaminD).toHaveLength(2);

      // Повтор страницы с витамином D не создаёт дополнительное измерение.
      const current = vitaminD.find((row) => row.collectedAt === '2027-01-15')!;
      const currentSources = repo.listSources(current.id);
      expect(currentSources).toHaveLength(2);
      expect(currentSources.map((source) => source.pageNumber).sort()).toEqual([
        1, 3,
      ]);
      expect(
        currentSources.every(
          (source) => source.sourceKind === 'current_result',
        ),
      ).toBe(true);
      expect(current.referenceJson?.originalText).toBe('30 – 100 нг/мл');
      expect(current.referenceAssessment).toBe('within');

      // Историческое значение не наследует референс текущего результата.
      const historical = vitaminD.find(
        (row) => row.collectedAt === '2026-06-10',
      )!;
      expect(historical.referenceJson).toBeNull();
      expect(historical.referenceAssessment).toBe('unknown');
      const historicalSources = repo.listSources(historical.id);
      expect(historicalSources).toHaveLength(1);
      expect(historicalSources[0]!.sourceKind).toBe('historical_result');

      // Документ обогащён метаданными лаборатории.
      const document = repo.findDocument('owner', 'document-1')!;
      expect(document.laboratoryName).toBe('Синтетическая лаборатория');
      expect(document.collectedAt).toBe('2027-01-15');
      expect(document.issuedAt).toBe('2027-01-15');

      // Повторная обработка не создаёт дубликаты измерений.
      const now = Date.now();
      repo.insertJob({
        id: 'job-2',
        ownerId: 'owner',
        documentId: 'document-1',
        status: 'queued',
        stage: 'upload_validation',
        attempts: 0,
        lastError: null,
        leaseUntil: null,
        createdAt: now,
        updatedAt: now,
      });
      await worker.runQueue();
      expect(repo.listObservations('owner', {})).toHaveLength(6);
      expect(repo.findJobById('job-2')!.status).toBe('completed');
    },
  );

  it('marks scanned pages as ocr-applied', async () => {
    const { medicalDocumentPages } =
      await import('@/server/db/schema/anamnesis');
    const pages = database.db.select().from(medicalDocumentPages).all();
    expect(pages).toHaveLength(3);
    expect(pages.every((page) => !page.hasTextLayer)).toBe(true);
    expect(pages.every((page) => page.ocrApplied)).toBe(true);
  });
});

afterAll(() => {
  database.sqlite.close();
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('review routing for uncertain recognition', () => {
  it('sends unknown source kinds and unproven duplicates to review', async () => {
    await ensureAnamnesisCatalog(database);
    const now = Date.now();
    const bytes = new Uint8Array(
      readFileSync('tests/fixtures/anamnesis/synthetic-lab.pdf'),
    );
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storage = fsObjectStorage({ rootDir: storageRoot });
    await storage.put(`anamnesis/owner2/${sha256}.pdf`, bytes);
    database.db
      .insert(user)
      .values({
        id: 'owner2',
        name: 'Owner2',
        email: 'owner2@example.test',
        emailVerified: true,
        createdAt: new Date(now),
        updatedAt: new Date(now),
        // Единственный OWNER ограничен частичным индексом; для изоляции
        // данных достаточно любого пользователя.
        role: 'TRAINER',
      })
      .onConflictDoNothing()
      .run();
    repo.insertDocument({
      id: 'document-2',
      ownerId: 'owner2',
      filename: 'mixed.pdf',
      storageKey: `anamnesis/owner2/${sha256}.pdf`,
      sha256,
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      pageCount: 3,
      laboratoryName: null,
      title: null,
      collectedAt: null,
      issuedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    repo.insertObservation({
      id: 'obs-existing-lab-a',
      ownerId: 'owner2',
      markerId: 'alt',
      originalName: 'АЛТ',
      valueJson: { kind: 'numeric', value: '30.1', comparator: 'eq' },
      originalUnit: 'Ед/л',
      normalizedValue: '30.1',
      normalizedUnit: 'U/L',
      collectedAt: '2027-01-15',
      datePrecision: 'date',
      laboratoryName: 'Лаборатория А',
      referenceJson: null,
      referenceAssessment: 'unknown',
      verification: 'user_verified',
      extractionVersion: '1',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    repo.insertJob({
      id: 'job-mixed',
      ownerId: 'owner2',
      documentId: 'document-2',
      status: 'queued',
      stage: 'upload_validation',
      attempts: 0,
      lastError: null,
      leaseUntil: null,
      createdAt: now,
      updatedAt: now,
    });
    const mixedWorker = createAnamnesisWorker({
      database,
      storage: fsObjectStorage({ rootDir: storageRoot }),
      provider: {
        name: 'mixed',
        extract: async () => ({
          laboratory: 'Лаборатория Б',
          title: null,
          issuedAt: '15.01.2027',
          observations: [
            {
              // Та же дата и значение, но другая лаборатория: совпадение
              // не доказано — возможный дубль.
              name: 'АЛТ',
              rawText: 'АЛТ 30,1 Ед/л',
              pageNumber: 1,
              value: '30,1',
              comparator: 'eq',
              unit: 'Ед/л',
              collectedAt: '15.01.2027',
              sourceKind: 'current_result',
              reference: null,
            },
            {
              // Роль результата не распознана — обязательная проверка.
              name: 'АСТ',
              rawText: 'АСТ 25,3 Ед/л',
              pageNumber: 1,
              value: '25,3',
              comparator: 'eq',
              unit: 'Ед/л',
              collectedAt: '15.01.2027',
              sourceKind: 'непонятная роль',
              reference: null,
            },
          ],
        }),
      },
    });
    await mixedWorker.runQueue();

    const job = repo.findJobById('job-mixed')!;
    expect(job.status).toBe('completed_with_warnings');

    const observations = repo.listObservations('owner2', {});
    const altObservations = observations.filter(
      (row) => row.markerId === 'alt',
    );
    expect(altObservations).toHaveLength(2);
    // Существующая запись владельца не тронута, новая ушла на проверку.
    const existing = altObservations.find(
      (row) => row.id === 'obs-existing-lab-a',
    )!;
    expect(existing.verification).toBe('user_verified');
    const added = altObservations.find(
      (row) => row.id !== 'obs-existing-lab-a',
    )!;
    expect(added.verification).toBe('needs_review');
    const allReviews = database.db
      .select()
      .from((await import('@/server/db/schema/anamnesis')).medicalReviewItems)
      .all();
    const addedReview = allReviews.find(
      (review) => review.observationId === added.id,
    );
    expect(addedReview?.reason).toBe('possible_duplicate');
    // История существующей записи не получила новых проверок.
    expect(
      allReviews.filter(
        (review) => review.observationId === 'obs-existing-lab-a',
      ),
    ).toHaveLength(0);

    // Неизвестная роль результата уходит на проверку с точной причиной.
    const ast = observations.find((row) => row.markerId === 'ast')!;
    expect(ast.verification).toBe('needs_review');
    const astReview = allReviews.find(
      (review) => review.observationId === ast.id,
    );
    expect(astReview?.reason).toBe('unknown_source_kind');
  });
});
