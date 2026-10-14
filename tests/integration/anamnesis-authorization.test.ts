import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { ZodError } from 'zod';

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
  objects: new Map<string, Uint8Array>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: async () => state.session } }),
}));
const database = vi.hoisted(() => {
  // Отложенное открытие: освобождает мок '@/server/db' от цикла.
  return {
    handle: null as null | ReturnType<
      (typeof import('@/server/db/connection'))['openDatabase']
    >,
  };
});
vi.mock('@/server/db', async () => {
  const { openDatabase } = await import('@/server/db/connection');
  database.handle ??= openDatabase('file::memory:');
  return { getDatabase: () => database.handle };
});
vi.mock('@/server/storage', () => ({
  getObjectStorage: () => ({
    put: async (key: string, bytes: Uint8Array) => {
      state.objects.set(key, bytes);
    },
    get: async (key: string) => {
      const bytes = state.objects.get(key);
      if (!bytes) throw new Error('missing object');
      return bytes;
    },
    remove: async (key: string) => {
      state.objects.delete(key);
    },
  }),
}));
vi.mock('@/server/anamnesis/worker', () => ({
  kickAnamnesisImport: () => {},
  anamnesisDocumentStorageKey: (ownerId: string, sha256: string) =>
    `anamnesis/${ownerId}/${sha256}.pdf`,
  anamnesisReportStorageKey: (id: string) => `anamnesis/reports/${id}.pdf`,
}));

const fixtureBytes = () =>
  new Uint8Array(readFileSync('tests/fixtures/anamnesis/synthetic-lab.pdf'));

const headers = () => new Headers({ 'content-type': 'application/json' });

const { ensureAnamnesisCatalog } = await import('@/server/anamnesis/catalog');

describe('anamnesis authorization and grants', () => {
  let service: typeof import('@/server/anamnesis');
  let repo: ReturnType<
    (typeof import('@/server/anamnesis/repository'))['anamnesisRepository']
  >;
  let connection: NonNullable<typeof database.handle>;
  const ownerHeaders = headers();

  beforeAll(async () => {
    service = await import('@/server/anamnesis');
    const { anamnesisRepository } =
      await import('@/server/anamnesis/repository');
    connection = database.handle!;
    await migrate(connection.db, { migrationsFolder: './drizzle' });
    repo = anamnesisRepository(connection.db);
  });

  beforeEach(() => {
    state.session = { user: { id: 'owner', role: 'OWNER' } };
  });

  afterEach(() => {
    state.session = null;
  });

  async function seedUsers() {
    const { user, trainerAccess } = await import('@/server/db/schema');
    const now = new Date();
    for (const [id, role] of [
      ['owner', 'OWNER'],
      ['11111111-1111-4111-8111-111111111111', 'TRAINER'],
      ['other-owner', 'OWNER'],
    ] as const)
      connection.db
        .insert(user)
        .values({
          id,
          name: id,
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
          role,
        })
        .onConflictDoNothing()
        .run();
    connection.db
      .insert(trainerAccess)
      .values({
        trainerId: '11111111-1111-4111-8111-111111111111',
        ownerId: 'owner',
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  it('owner uploads, trainer sees nothing without grants, grants open selective access', async () => {
    await seedUsers();
    await ensureAnamnesisCatalog(database.handle!);

    const upload = await service.uploadAnamnesisDocument(
      ownerHeaders,
      'owner',
      {
        filename: 'synthetic-lab.pdf',
        bytes: fixtureBytes(),
      },
    );
    expect(upload.duplicate).toBe(false);
    expect(upload.document.pageCount).toBe(3);
    expect(upload.importJob?.status).toBe('queued');

    const duplicate = await service.uploadAnamnesisDocument(
      ownerHeaders,
      'owner',
      {
        filename: 'copy.pdf',
        bytes: fixtureBytes(),
      },
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.document.id).toBe(upload.document.id);
    expect(
      await service.listAnamnesisDocuments(ownerHeaders, 'owner'),
    ).toHaveLength(1);

    // Изоляция: другой владелец не видит документ.
    state.session = { user: { id: 'other-owner', role: 'OWNER' } };
    expect(
      await service.listAnamnesisDocuments(headers(), 'other-owner'),
    ).toHaveLength(0);
    await expect(
      service.getAnamnesisDocumentFile(
        headers(),
        'other-owner',
        upload.document.id,
      ),
    ).rejects.toMatchObject({ status: 404 });

    // Тренер без грантов не получает ни показатели, ни оригинал.
    state.session = {
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'TRAINER' },
    };
    const trainerHeaders = headers();
    expect(
      await service.listAnamnesisMarkers(trainerHeaders, 'owner'),
    ).toHaveLength(0);
    expect(
      await service.listAnamnesisDocuments(trainerHeaders, 'owner'),
    ).toHaveLength(0);
    await expect(
      service.getAnamnesisDocumentFile(
        trainerHeaders,
        'owner',
        upload.document.id,
      ),
    ).rejects.toMatchObject({ status: 403 });

    // Грант на показатель открывает измерения, но не документ.
    state.session = { user: { id: 'owner', role: 'OWNER' } };
    await service.setAnamnesisMarkerGrant(
      ownerHeaders,
      'owner',
      'vitamin-d-25oh',
      {
        trainerId: '11111111-1111-4111-8111-111111111111',
        enabled: true,
      },
    );
    state.session = {
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'TRAINER' },
    };
    const markers = await service.listAnamnesisMarkers(trainerHeaders, 'owner');
    expect(markers).toHaveLength(0); // измерений ещё нет — показывать нечего
    await expect(
      service.getAnamnesisDocumentFile(
        trainerHeaders,
        'owner',
        upload.document.id,
      ),
    ).rejects.toMatchObject({ status: 403 });

    // Появилось измерение — грант показывает только разрешённый показатель.
    const now = Date.now();
    repo.insertObservation({
      id: 'obs-1',
      ownerId: 'owner',
      markerId: 'vitamin-d-25oh',
      originalName: '25-OH Витамин D',
      valueJson: { kind: 'numeric', value: '41.2', comparator: 'eq' },
      originalUnit: 'нг/мл',
      normalizedValue: '41.2',
      normalizedUnit: 'нг/мл',
      collectedAt: '2027-01-15',
      datePrecision: 'date',
      laboratoryName: 'Синтетическая лаборатория',
      referenceJson: null,
      referenceAssessment: 'unknown',
      verification: 'needs_review',
      extractionVersion: '1',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    repo.insertObservation({
      id: 'obs-2',
      ownerId: 'owner',
      markerId: 'alt',
      originalName: 'АЛТ',
      valueJson: { kind: 'numeric', value: '30.1', comparator: 'eq' },
      originalUnit: 'Ед/л',
      normalizedValue: '30.1',
      normalizedUnit: 'U/L',
      collectedAt: '2027-01-15',
      datePrecision: 'date',
      laboratoryName: 'Синтетическая лаборатория',
      referenceJson: null,
      referenceAssessment: 'unknown',
      verification: 'auto_verified',
      extractionVersion: '1',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    const grantedMarkers = await service.listAnamnesisMarkers(
      trainerHeaders,
      'owner',
    );
    expect(grantedMarkers.map((summary) => summary.marker.id)).toEqual([
      'vitamin-d-25oh',
    ]);
    await expect(
      service.listMarkerObservations(trainerHeaders, 'owner', 'alt', {}),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await service.listMarkerObservations(
        trainerHeaders,
        'owner',
        'vitamin-d-25oh',
        {},
      ),
    ).toHaveLength(1);

    // Грант на документ открывает оригинал — отдельно от показателей.
    state.session = { user: { id: 'owner', role: 'OWNER' } };
    await service.setAnamnesisDocumentGrant(
      ownerHeaders,
      'owner',
      upload.document.id,
      {
        trainerId: '11111111-1111-4111-8111-111111111111',
        enabled: true,
      },
    );
    state.session = {
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'TRAINER' },
    };
    const file = await service.getAnamnesisDocumentFile(
      trainerHeaders,
      'owner',
      upload.document.id,
    );
    expect(file.filename).toBe('synthetic-lab.pdf');

    // Отзыв общего доступа мгновенно глушит медицинские гранты.
    const { trainerAccess } = await import('@/server/db/schema');
    connection.db
      .delete(trainerAccess)
      .where(
        (await import('drizzle-orm')).eq(
          trainerAccess.trainerId,
          '11111111-1111-4111-8111-111111111111',
        ),
      )
      .run();
    await expect(
      service.getAnamnesisDocumentFile(
        trainerHeaders,
        'owner',
        upload.document.id,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.listAnamnesisMarkers(trainerHeaders, 'owner'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('review confirm edits the observation and records history with optimistic locking', async () => {
    await seedUsers();
    const now = Date.now();
    const documentId = repo.insertDocument({
      id: 'doc-review',
      ownerId: 'owner',
      filename: 'lab.pdf',
      storageKey: 'anamnesis/owner/aaa.pdf',
      sha256: 'a'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 10,
      pageCount: 1,
      laboratoryName: null,
      title: null,
      collectedAt: null,
      issuedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).id;
    repo.insertObservation({
      id: 'obs-review',
      ownerId: 'owner',
      markerId: null,
      originalName: 'Креатинин',
      valueJson: { kind: 'numeric', value: '80', comparator: 'eq' },
      originalUnit: 'мкмоль/л',
      normalizedValue: null,
      normalizedUnit: null,
      collectedAt: '2027-01-15',
      datePrecision: 'date',
      laboratoryName: null,
      referenceJson: null,
      referenceAssessment: 'unknown',
      verification: 'needs_review',
      extractionVersion: '1',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    repo.insertReview({
      id: 'review-1',
      ownerId: 'owner',
      observationId: 'obs-review',
      documentId,
      reason: 'ambiguous_marker',
      status: 'pending',
      createdAt: now,
      resolvedAt: null,
      resolvedBy: null,
    });

    const correction = {
      expectedRevision: 1,
      markerId: 'alt',
      value: { kind: 'numeric', value: '80', comparator: 'eq' },
      originalUnit: 'мкмоль/л',
      collectedAt: '2027-01-15',
      datePrecision: 'date',
      referenceRange: null,
    };

    // Конфликт версий отклоняется, проверка остаётся открытой.
    await expect(
      service.confirmAnamnesisReview(ownerHeaders, 'owner', 'review-1', {
        ...correction,
        expectedRevision: 7,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(repo.findReview('owner', 'review-1')!.status).toBe('pending');

    const confirmed = await service.confirmAnamnesisReview(
      ownerHeaders,
      'owner',
      'review-1',
      correction,
    );
    expect(confirmed.verification).toBe('user_verified');
    expect(confirmed.markerId).toBe('alt');
    expect(confirmed.revision).toBe(2);

    const revisions = repo.listRevisions('obs-review');
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.reason).toBe('review_confirm');
    expect(
      revisions[0]!.changesJson.some((change) => change.field === 'markerId'),
    ).toBe(true);

    // Тренер не может подтверждать проверки.
    state.session = {
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'TRAINER' },
    };
    await expect(
      service.getAnamnesisAccess(headers(), 'owner'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('report visibility follows current grants even after generation', async () => {
    await seedUsers();
    const now = Date.now();
    repo.insertReport({
      id: 'report-1',
      ownerId: 'owner',
      createdBy: 'owner',
      markerIdsJson: ['vitamin-d-25oh', 'alt'],
      dateFrom: null,
      dateTo: null,
      status: 'ready',
      storageKey: 'anamnesis/reports/report-1.pdf',
      filename: 'anamnesis.pdf',
      sizeBytes: 1024,
      createdAt: now,
    });
    state.objects.set(
      'anamnesis/reports/report-1.pdf',
      new Uint8Array([1, 2, 3]),
    );

    state.session = {
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'TRAINER' },
    };
    const trainerHeaders = headers();
    // Нет грантов — отчёт не виден и не скачивается.
    expect(
      await service.listAnamnesisReports(trainerHeaders, 'owner'),
    ).toHaveLength(0);
    await expect(
      service.getAnamnesisReportFile(trainerHeaders, 'owner', 'report-1'),
    ).rejects.toMatchObject({ status: 403 });

    state.session = { user: { id: 'owner', role: 'OWNER' } };
    await service.setAnamnesisMarkerGrant(
      ownerHeaders,
      'owner',
      'vitamin-d-25oh',
      {
        trainerId: '11111111-1111-4111-8111-111111111111',
        enabled: true,
      },
    );
    state.session = {
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'TRAINER' },
    };
    // Грант только на один из двух показателей — отчёт по-прежнему скрыт.
    expect(
      await service.listAnamnesisReports(trainerHeaders, 'owner'),
    ).toHaveLength(0);
    state.session = { user: { id: 'owner', role: 'OWNER' } };
    await service.setAnamnesisMarkerGrant(ownerHeaders, 'owner', 'alt', {
      trainerId: '11111111-1111-4111-8111-111111111111',
      enabled: true,
    });
    state.session = {
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'TRAINER' },
    };
    expect(
      await service.listAnamnesisReports(trainerHeaders, 'owner'),
    ).toHaveLength(1);
    const file = await service.getAnamnesisReportFile(
      trainerHeaders,
      'owner',
      'report-1',
    );
    expect(file.filename).toBe('anamnesis.pdf');

    // Отзыв одного гранта немедленно закрывает скачивание.
    state.session = { user: { id: 'owner', role: 'OWNER' } };
    await service.setAnamnesisMarkerGrant(ownerHeaders, 'owner', 'alt', {
      trainerId: '11111111-1111-4111-8111-111111111111',
      enabled: false,
    });
    state.session = {
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'TRAINER' },
    };
    await expect(
      service.getAnamnesisReportFile(trainerHeaders, 'owner', 'report-1'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('never leaks sources of ungranted documents through deduplicated observations', async () => {
    await seedUsers();
    await ensureAnamnesisCatalog(database.handle!);
    const now = Date.now();
    const trainerId = '11111111-1111-4111-8111-111111111111';

    const documentA = repo.insertDocument({
      id: 'doc-ungranted',
      ownerId: 'owner',
      filename: 'a.pdf',
      storageKey: 'anamnesis/owner/ccc.pdf',
      sha256: 'c'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 10,
      pageCount: 1,
      laboratoryName: null,
      title: null,
      collectedAt: null,
      issuedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).id;
    const documentB = repo.insertDocument({
      id: 'doc-granted',
      ownerId: 'owner',
      filename: 'b.pdf',
      storageKey: 'anamnesis/owner/ddd.pdf',
      sha256: 'd'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 10,
      pageCount: 1,
      laboratoryName: null,
      title: null,
      collectedAt: null,
      issuedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).id;

    // Одно измерение с источниками в обоих документах (дедупликация).
    repo.insertObservation({
      id: 'obs-shared',
      ownerId: 'owner',
      markerId: 'vitamin-d-25oh',
      originalName: '25-OH Витамин D',
      valueJson: { kind: 'numeric', value: '41.2', comparator: 'eq' },
      originalUnit: 'нг/мл',
      normalizedValue: '41.2',
      normalizedUnit: 'нг/мл',
      collectedAt: '2027-01-15',
      datePrecision: 'date',
      laboratoryName: 'Синтетическая лаборатория',
      referenceJson: null,
      referenceAssessment: 'unknown',
      verification: 'auto_verified',
      extractionVersion: '1',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    repo.insertSources([
      {
        id: 'source-a',
        observationId: 'obs-shared',
        documentId: documentA,
        pageNumber: 1,
        sourceKind: 'current_result',
        rawText: 'SECRET-FROM-UNGRANTED-DOCUMENT',
        boundingBoxJson: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
        extractionConfidence: null,
      },
      {
        id: 'source-b',
        observationId: 'obs-shared',
        documentId: documentB,
        pageNumber: 2,
        sourceKind: 'current_result',
        rawText: 'SHARED-VISIBLE-THROUGH-GRANT',
        boundingBoxJson: null,
        extractionConfidence: null,
      },
    ]);

    state.session = { user: { id: 'owner', role: 'OWNER' } };
    await service.setAnamnesisMarkerGrant(
      ownerHeaders,
      'owner',
      'vitamin-d-25oh',
      {
        trainerId,
        enabled: true,
      },
    );
    await service.setAnamnesisDocumentGrant(ownerHeaders, 'owner', documentB, {
      trainerId,
      enabled: true,
    });

    state.session = { user: { id: trainerId, role: 'TRAINER' } };
    const trainerHeaders = headers();

    // Документ B: источники только B, цитата A не раскрывается.
    const entries = await service.listAnamnesisDocumentObservations(
      trainerHeaders,
      'owner',
      documentB,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.sources).toHaveLength(1);
    expect(entries[0]!.sources[0]!.documentId).toBe(documentB);
    expect(
      JSON.stringify(entries).includes('SECRET-FROM-UNGRANTED-DOCUMENT'),
    ).toBe(false);

    // Отдельное измерение: маркерный грант без документального — источников нет.
    const observation = await service.getAnamnesisObservation(
      trainerHeaders,
      'owner',
      'obs-shared',
    );
    expect(observation.sources.map((source) => source.documentId)).toEqual([
      documentB,
    ]);
    expect(
      observation.sources.some((source) =>
        source.rawText.includes('SECRET-FROM-UNGRANTED-DOCUMENT'),
      ),
    ).toBe(false);

    // Очередь проверки тренеру закрыта полностью.
    await expect(
      service.listAnamnesisReviews(trainerHeaders, 'owner'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('corrections recompute normalization and trainer overview stays grant-scoped', async () => {
    await seedUsers();
    await ensureAnamnesisCatalog(database.handle!);
    const now = Date.now();
    const trainerId = '11111111-1111-4111-8111-111111111111';
    state.session = { user: { id: 'owner', role: 'OWNER' } };
    // Тесты делят базу: снимаем гранты, оставленные предыдущими сценариями.
    await service.setAnamnesisMarkerGrant(
      ownerHeaders,
      'owner',
      'vitamin-d-25oh',
      {
        trainerId,
        enabled: false,
      },
    );
    for (const documentRow of repo.listDocuments('owner'))
      await service.setAnamnesisDocumentGrant(
        ownerHeaders,
        'owner',
        documentRow.id,
        { trainerId, enabled: false },
      );
    const baseline = await service.getAnamnesisOverview(ownerHeaders, 'owner');

    const documentId = repo.insertDocument({
      id: 'doc-normalize',
      ownerId: 'owner',
      filename: 'n.pdf',
      storageKey: 'anamnesis/owner/eee.pdf',
      sha256: 'e'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 10,
      pageCount: 1,
      laboratoryName: null,
      title: null,
      collectedAt: null,
      issuedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).id;
    repo.insertObservation({
      id: 'obs-normalize',
      ownerId: 'owner',
      markerId: 'vitamin-d-25oh',
      originalName: '25-OH Витамин D',
      valueJson: { kind: 'numeric', value: '41.2', comparator: 'eq' },
      originalUnit: 'нг/мл',
      normalizedValue: '41.2',
      normalizedUnit: 'нг/мл',
      collectedAt: '2027-01-15',
      datePrecision: 'date',
      laboratoryName: null,
      referenceJson: null,
      referenceAssessment: 'unknown',
      verification: 'needs_review',
      extractionVersion: '1',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    repo.insertObservation({
      id: 'obs-other-marker',
      ownerId: 'owner',
      markerId: 'alt',
      originalName: 'АЛТ',
      valueJson: { kind: 'numeric', value: '30.1', comparator: 'eq' },
      originalUnit: 'Ед/л',
      normalizedValue: '30.1',
      normalizedUnit: 'U/L',
      collectedAt: '2027-02-20',
      datePrecision: 'date',
      laboratoryName: null,
      referenceJson: null,
      referenceAssessment: 'unknown',
      verification: 'auto_verified',
      extractionVersion: '1',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    repo.insertReview({
      id: 'review-normalize',
      ownerId: 'owner',
      observationId: 'obs-normalize',
      documentId,
      reason: 'missing_date',
      status: 'pending',
      createdAt: now,
      resolvedAt: null,
      resolvedBy: null,
    });
    repo.insertJob({
      id: 'job-active',
      ownerId: 'owner',
      documentId,
      status: 'queued',
      stage: 'upload_validation',
      attempts: 0,
      lastError: null,
      leaseUntil: null,
      createdAt: now,
      updatedAt: now,
    });

    // Правка значения и единицы пересчитывает нормализацию, а не наследует её.
    const corrected = await service.correctAnamnesisObservation(
      ownerHeaders,
      'owner',
      'obs-normalize',
      {
        expectedRevision: 1,
        markerId: 'total-bilirubin',
        value: { kind: 'numeric', value: '9.1', comparator: 'eq' },
        originalUnit: 'мкмоль/л',
        collectedAt: '2027-01-15',
        datePrecision: 'date',
        referenceRange: null,
      },
    );
    expect(corrected.normalizedValue).toBe('9.1');
    expect(corrected.normalizedUnit).toBe('мкмоль/л');

    // Сводка владельца видит весь архив (тесты делят базу — сравниваем дельты).
    state.session = { user: { id: 'owner', role: 'OWNER' } };
    const ownerOverview = await service.getAnamnesisOverview(
      ownerHeaders,
      'owner',
    );
    expect(ownerOverview.documents).toBe(baseline.documents + 1);
    expect(ownerOverview.observations).toBe(baseline.observations + 2);
    expect(ownerOverview.pendingReviews).toBe(baseline.pendingReviews + 1);
    expect(ownerOverview.activeImports).toBe(baseline.activeImports + 1);
    expect(ownerOverview.lastCollectedAt).toBe('2027-02-20');

    // Без грантов сводка тренера пуста и не раскрывает архив.
    state.session = { user: { id: trainerId, role: 'TRAINER' } };
    const trainerHeaders = headers();
    const emptyOverview = await service.getAnamnesisOverview(
      trainerHeaders,
      'owner',
    );
    expect(emptyOverview.documents).toBe(0);
    expect(emptyOverview.observations).toBe(0);
    expect(emptyOverview.pendingReviews).toBe(0);
    expect(emptyOverview.activeImports).toBe(0);
    expect(emptyOverview.lastCollectedAt).toBeNull();

    // Грант на показатель открывает только его измерения: документы и
    // импорты остаются закрытыми, счётчики считаются по разрешённым данным.
    state.session = { user: { id: 'owner', role: 'OWNER' } };
    await service.setAnamnesisMarkerGrant(
      ownerHeaders,
      'owner',
      'vitamin-d-25oh',
      {
        trainerId,
        enabled: true,
      },
    );
    const vitaminRows = repo.listObservations('owner', {
      markerIds: ['vitamin-d-25oh'],
    });
    const expectedLast = vitaminRows.reduce(
      (max, row) =>
        row.collectedAt && row.collectedAt > max ? row.collectedAt : max,
      '',
    );
    state.session = { user: { id: trainerId, role: 'TRAINER' } };
    const trainerOverview = await service.getAnamnesisOverview(
      trainerHeaders,
      'owner',
    );
    expect(trainerOverview.observations).toBe(vitaminRows.length);
    expect(trainerOverview.markers).toBe(1);
    expect(trainerOverview.documents).toBe(0);
    expect(trainerOverview.activeImports).toBe(0);
    expect(trainerOverview.lastCollectedAt).toBe(expectedLast || null);
  });

  it('soft-deleted documents can be re-uploaded and trainer imports stay grant-scoped', async () => {
    await seedUsers();
    const trainerId = '11111111-1111-4111-8111-111111111111';
    state.session = { user: { id: 'owner', role: 'OWNER' } };
    // Тесты делят базу: снимаем гранты документов предыдущих сценариев.
    for (const documentRow of repo.listDocuments('owner'))
      await service.setAnamnesisDocumentGrant(
        ownerHeaders,
        'owner',
        documentRow.id,
        { trainerId, enabled: false },
      );
    // Тесты делят базу: файл уже загружен первым сценарием.
    const existing = await service.uploadAnamnesisDocument(
      ownerHeaders,
      'owner',
      {
        filename: 'again.pdf',
        bytes: fixtureBytes(),
      },
    );
    expect(existing.duplicate).toBe(true);
    await service.deleteAnamnesisDocument(
      ownerHeaders,
      'owner',
      existing.document.id,
    );
    // Мягко удалённый файл загружается снова без конфликта уникальности.
    const reupload = await service.uploadAnamnesisDocument(
      ownerHeaders,
      'owner',
      {
        filename: 'again.pdf',
        bytes: fixtureBytes(),
      },
    );
    expect(reupload.duplicate).toBe(false);
    expect(reupload.document.id).not.toBe(existing.document.id);

    // Импорты тренера фильтруются по грантам документов.
    state.session = { user: { id: trainerId, role: 'TRAINER' } };
    const trainerHeaders = headers();
    expect(
      await service.listAnamnesisImports(trainerHeaders, 'owner'),
    ).toHaveLength(0);
    await expect(
      service.getAnamnesisImport(
        trainerHeaders,
        'owner',
        reupload.importJob!.id,
      ),
    ).rejects.toMatchObject({ status: 403 });
    state.session = { user: { id: 'owner', role: 'OWNER' } };
    await service.setAnamnesisDocumentGrant(
      ownerHeaders,
      'owner',
      reupload.document.id,
      { trainerId, enabled: true },
    );
    state.session = { user: { id: trainerId, role: 'TRAINER' } };
    const trainerImports = await service.listAnamnesisImports(
      trainerHeaders,
      'owner',
    );
    expect(trainerImports.map((job) => job.documentId)).toEqual([
      reupload.document.id,
    ]);

    // Некорректная корректировка — ZodError: маршрут отвечает 400, не 500.
    state.session = { user: { id: 'owner', role: 'OWNER' } };
    const invalid = await service
      .correctAnamnesisObservation(ownerHeaders, 'owner', 'obs-1', {
        nonsense: true,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(invalid).toBeInstanceOf(ZodError);
    expect(service.anamnesisErrorResponse(invalid).status).toBe(400);
  });

  it('rejects uploads that are not PDFs', async () => {
    await seedUsers();
    await expect(
      service.uploadAnamnesisDocument(ownerHeaders, 'owner', {
        filename: 'report.pdf',
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  afterAll(() => {
    database.handle?.sqlite.close();
  });
});
