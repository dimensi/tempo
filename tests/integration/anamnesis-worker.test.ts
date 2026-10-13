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
