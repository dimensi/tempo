import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { test, expect, type Page } from '../ci/isolated-test';
import { getSessionWith429Retry } from './auth-session';

async function login(page: Page, role: 'owner' | 'trainer', origin: string) {
  return signIn(
    page,
    `${role}@example.test`,
    'Test-only-password-12345',
    origin,
  );
}

async function signIn(
  page: Page,
  email: string,
  password: string,
  origin: string,
) {
  const signInRequest = () =>
    page.request.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email, password },
    });
  // Троттлинг входа нагревается соседними спеками полного прогона:
  // ждём retry-after и повторяем, пока сервер не примет вход.
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await signInRequest();
    if (response.status() !== 429) {
      expect(response.ok()).toBe(true);
      return (await getSessionWith429Retry(page.request)).user;
    }
    const seconds = Number(
      response.headers()['x-retry-after'] ??
        response.headers()['retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
  }
  throw new Error('Sign-in remained throttled after retries');
}

interface ImportJob {
  status: string;
}

interface MarkerSummary {
  marker: { id: string; name: string };
  observationCount: number;
}

async function waitForImport(page: Page, ownerId: string): Promise<ImportJob> {
  const deadline = Date.now() + 60000;
  for (;;) {
    const jobs = (await (
      await page.request.get(`/api/anamnesis/imports?ownerId=${ownerId}`)
    ).json()) as ImportJob[];
    const active = jobs[0];
    if (
      active &&
      ['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(
        active.status,
      )
    )
      return active;
    if (Date.now() > deadline) throw new Error('Import did not finish in time');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const fixturePdf = () =>
  readFileSync('tests/fixtures/anamnesis/synthetic-lab.pdf');

test('owner imports the reference PDF and trainer receives only granted access', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(180000);
  const origin = baseURL!;
  const owner = await login(page, 'owner', origin);
  const ownerQuery = `ownerId=${owner.id}`;

  // The overview must expose the actual upload form without a guessed URL.
  await page.goto('/anamnesis');
  await page
    .getByRole('navigation', { name: 'Разделы анамнеза' })
    .getByRole('link', { name: 'Документы и распознавание' })
    .click();
  await expect(page).toHaveURL(/\/anamnesis#documents$/);
  await expect(page.getByLabel('Загрузить PDF')).toBeVisible();

  // Тренер получает доступ через настоящее приглашение (trainer_access).
  // Проекты и повторы делят одну e2e-базу: аккаунт уникален для каждого
  // запуска, чтобы приглашение оставалось одноразовым.
  const trainerEmail = `anamnesis-${test.info().project.name}-${Date.now()}@example.test`;
  const invitation = await page.request.post('/api/trainers/invitations', {
    headers: { origin },
    data: { ownerId: owner.id, email: trainerEmail },
  });
  expect(invitation.status()).toBe(200);
  const { token } = (await invitation.json()) as { token: string };
  const accept = await page.request.post('/api/trainers/invitations/accept', {
    data: {
      token,
      name: 'Anamnesis trainer',
      password: 'Synthetic-password-123',
    },
  });
  expect(accept.ok()).toBe(true);
  const trainerContext = await browser.newContext();
  const trainerPage = await trainerContext.newPage();
  const trainer = await signIn(
    trainerPage,
    trainerEmail,
    'Synthetic-password-123',
    origin,
  );
  const trainerQuery = `ownerId=${owner.id}`;

  // Независимый precondition: документы владельца до загрузки. Первый прогон
  // проекта начинается с пустым архивом; повторы и mobile-проект застают
  // файл уже загруженным (проекты делят одну e2e-базу).
  const before = (await (
    await page.request.get(`/api/anamnesis/documents?${ownerQuery}`)
  ).json()) as Array<{ id: string; filename: string }>;
  if (process.env.CI_E2E_WORKER === 'true') expect(before).toHaveLength(0);
  const existing = before.find(
    (item) =>
      item.filename === 'synthetic-lab.pdf' || item.filename === 'copy.pdf',
  );

  // Загрузка контрольного документа «Синтетическая лаборатория».
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().includes('/api/anamnesis/documents/uploads?') &&
      response.request().method() === 'POST',
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'synthetic-lab.pdf',
    mimeType: 'application/pdf',
    buffer: fixturePdf(),
  });
  await page
    .getByTestId('anamnesis-documents')
    .getByRole('button', { name: 'Загрузить PDF', exact: true })
    .filter({ hasText: 'Загрузить PDF' })
    .click();
  const upload = await uploaded;
  expect(upload.status()).toBe(201);
  const document = (await upload.json()) as {
    document: { id: string; pageCount: number };
    importJob: { id: string; status: string } | null;
    duplicate: boolean;
  };
  expect(document.document.pageCount).toBe(3);
  if (existing) {
    // Файл уже в архиве: повторная загрузка обязана вернуть тот же документ
    // без нового задания импорта.
    expect(document.duplicate).toBe(true);
    expect(document.document.id).toBe(existing.id);
    expect(document.importJob).toBeNull();
  } else {
    expect(document.duplicate).toBe(false);
    expect(document.importJob).not.toBeNull();
    await waitForImport(page, owner.id);
  }

  // Повторная загрузка того же файла не создаёт дубль.
  const duplicate = await page.request.post(
    `/api/anamnesis/documents/uploads?${ownerQuery}`,
    {
      headers: { origin },
      multipart: {
        file: {
          name: 'copy.pdf',
          mimeType: 'application/pdf',
          buffer: fixturePdf(),
        },
      },
    },
  );
  const duplicateResponse = (await duplicate.json()) as {
    document: { id: string };
    duplicate: boolean;
  };
  expect(duplicateResponse.duplicate).toBe(true);
  expect(duplicateResponse.document.id).toBe(document.document.id);

  // ТЗ §9 — шесть измерений, пять показателей. Данные либо только что
  // импортированы, либо уже лежат в базе от предыдущего прогона проекта.
  const job = await waitForImport(page, owner.id);
  expect(job.status).toBe('completed');
  const markers = (await (
    await page.request.get(`/api/anamnesis/markers?${ownerQuery}`)
  ).json()) as MarkerSummary[];
  expect(markers).toHaveLength(5);
  expect(
    markers.reduce((sum, summary) => sum + summary.observationCount, 0),
  ).toBe(6);
  expect(
    markers.find((summary) => summary.marker.id === 'vitamin-d-25oh')!
      .observationCount,
  ).toBe(2);

  // Обзор и таблица показателей отображают импортированные данные.
  await expect(
    page
      .getByTestId('anamnesis-documents')
      .getByRole('link', { name: 'synthetic-lab.pdf', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Разделы анамнеза' })
    .getByRole('link', { name: 'Показатели' })
    .click();
  await expect(page.getByTestId('anamnesis-marker-table')).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Витамин D (25-OH)' }),
  ).toBeVisible();

  // Synthetic pending review fixture in the disposable E2E DB; real auth, persistence and confirm API.
  const altRows = (await (
    await page.request.get(
      `/api/anamnesis/markers/alt/observations?${ownerQuery}`,
    )
  ).json()) as Array<{ id: string }>;
  const reviewId = randomUUID();
  const fixtureDb = new Database('.data/e2e.sqlite');
  try {
    fixtureDb.pragma('busy_timeout=5000');
    fixtureDb.transaction(() => {
      fixtureDb
        .prepare(
          "UPDATE medical_observations SET verification='needs_review' WHERE id=? AND owner_id=?",
        )
        .run(altRows[0]!.id, owner.id);
      fixtureDb
        .prepare(
          "INSERT INTO medical_review_items(id,owner_id,observation_id,document_id,reason,status,created_at) VALUES(?,?,?,?,?,'pending',?)",
        )
        .run(
          reviewId,
          owner.id,
          altRows[0]!.id,
          document.document.id,
          'missing_origin',
          Date.now(),
        );
    })();
  } finally {
    fixtureDb.close();
  }
  await page.goto('/anamnesis#documents');
  await page.reload();
  await page
    .getByTestId('anamnesis-documents')
    .getByRole('button', { name: 'Проверка результатов (1)', exact: true })
    .click();
  const reviewItem = page.getByTestId('anamnesis-review-item');
  await expect(reviewItem).toHaveCount(1);
  await reviewItem
    .getByRole('button', { name: 'Подтвердить', exact: true })
    .click();
  await expect(reviewItem).toHaveCount(0);
  const reviewed = (await (
    await page.request.get(
      `/api/anamnesis/observations/${altRows[0]!.id}?${ownerQuery}`,
    )
  ).json()) as { observation: { verification: string } };
  expect(reviewed.observation.verification).toBe('user_verified');

  // Real report-builder interactions: checkbox events must survive deferred updates.
  const reportErrors: string[] = [];
  const onPageError = (error: Error) => reportErrors.push(error.message);
  page.on('pageerror', onPageError);
  await page
    .getByRole('navigation', { name: 'Разделы анамнеза' })
    .getByRole('link', { name: 'Экспорт' })
    .click();
  const builder = page.getByTestId('anamnesis-reports');
  const allMarkers = builder.getByRole('checkbox', {
    name: 'Выбрать все показатели',
    exact: true,
  });
  const generate = builder.getByRole('button', {
    name: 'Скачать PDF',
    exact: true,
  });
  await expect(allMarkers).toBeChecked();
  await expect(builder.getByRole('checkbox', { checked: true })).toHaveCount(7);
  const alt = builder.getByRole('checkbox', {
    name: 'Аланинаминотрансфераза (1)',
    exact: true,
  });
  const ast = builder.getByRole('checkbox', {
    name: 'Аспартатаминотрансфераза (1)',
    exact: true,
  });
  await alt.uncheck();
  await expect(allMarkers).toHaveJSProperty('indeterminate', true);
  await ast.uncheck();
  await alt.check();
  await ast.check();
  await expect(allMarkers).toBeChecked();
  await expect(
    builder.getByRole('button', { name: 'Снять выбор' }),
  ).toHaveCount(0);
  await allMarkers.uncheck();
  await expect(generate).toBeDisabled();
  await allMarkers.focus();
  await page.keyboard.press('Space');
  await expect(allMarkers).toBeChecked();
  const allHistory = builder.getByRole('checkbox', {
    name: 'Вся история',
    exact: true,
  });
  await allHistory.uncheck();
  const dateChoices = builder
    .getByRole('group', { name: 'Даты измерений' })
    .getByRole('checkbox');
  await expect(dateChoices).toHaveCount(2);
  await dateChoices.first().uncheck();
  // Mounted forms survive TOC navigation and browser history.
  const toc = page.getByRole('navigation', { name: 'Разделы анамнеза' });
  await toc.getByRole('link', { name: 'Показатели', exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/#export$/);
  await expect(dateChoices.first()).not.toBeChecked();
  await dateChoices.first().check();
  await expect(
    page
      .frameLocator('iframe[title="Предпросмотр"]')
      .locator('.observation-row'),
  ).toHaveCount(6);
  await allHistory.check();
  await expect(generate).toBeEnabled({ timeout: 30000 });
  const frame = page.frameLocator('iframe[title="Предпросмотр"]');
  await expect(frame.locator('.report-page')).toHaveCount(1);
  await expect(frame.locator('.observation-row')).toHaveCount(6);
  const exported = page.waitForResponse(
    (response) =>
      response.url().includes('/api/anamnesis/reports?') &&
      response.request().method() === 'POST',
  );
  const downloaded = page.waitForEvent('download', { timeout: 30000 });
  await generate.click();
  const exportResponse = await exported;
  expect(exportResponse.status()).toBe(201);
  expect(exportResponse.request().postDataJSON()).toMatchObject({
    markerIds: markers.map((item) => item.marker.id).sort(),
    dateKeys: null,
    snapshotKey: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect((await downloaded).suggestedFilename()).toMatch(/\.pdf$/);
  const allReport = (await exportResponse.json()) as { id: string };
  const savedReport = builder.getByTestId(`medical-report-${allReport.id}`);
  await expect(savedReport).toBeVisible();
  await savedReport.getByRole('button').click();
  await expect(
    builder.getByRole('link', { name: 'Открыть в новой вкладке' }),
  ).toHaveAttribute('href', /inline=1/);
  const inline = await page.request.get(
    `/api/anamnesis/reports/${allReport.id}/file?${ownerQuery}&inline=1`,
  );
  expect(inline.headers()['content-disposition']).toMatch(/^inline/);
  expect(inline.headers()['cache-control']).toContain('no-store');
  const allFile = await page.request.get(
    `/api/anamnesis/reports/${allReport.id}/file?${ownerQuery}`,
  );
  expect(allFile.status()).toBe(200);
  expect((await allFile.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await expect
    .poll(() =>
      page.evaluate(
        () => window.document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await expect(generate).toBeEnabled();
  await builder.locator('iframe').first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `/tmp/tempo-report-selection-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(reportErrors).toEqual([]);
  page.off('pageerror', onPageError);

  // Отчёт генерируется и скачивается.
  const previewResponse = await page.request.post(
    `/api/anamnesis/reports/preview?${ownerQuery}`,
    {
      headers: { origin },
      data: { markerIds: ['vitamin-d-25oh'], dateKeys: null },
    },
  );
  expect(previewResponse.status()).toBe(200);
  const singlePreview = (await previewResponse.json()) as {
    snapshotKey: string;
  };
  const report = await page.request.post(
    `/api/anamnesis/reports?${ownerQuery}`,
    {
      headers: { origin },
      data: {
        markerIds: ['vitamin-d-25oh'],
        dateKeys: null,
        snapshotKey: singlePreview.snapshotKey,
      },
    },
  );
  expect(report.status()).toBe(201);
  const { id: reportId } = (await report.json()) as { id: string };
  const reportFile = await page.request.get(
    `/api/anamnesis/reports/${reportId}/file?${ownerQuery}`,
  );
  expect(reportFile.status()).toBe(200);
  expect(reportFile.headers()['content-type']).toBe('application/pdf');

  // Тренер без грантов не видит показатели, документ и отчёт.
  const trainerMarkers = (await (
    await trainerPage.request.get(`/api/anamnesis/markers?${trainerQuery}`)
  ).json()) as MarkerSummary[];
  expect(trainerMarkers).toHaveLength(0);
  expect(
    (
      await trainerPage.request.get(
        `/api/anamnesis/documents/${document.document.id}/file?${trainerQuery}`,
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await trainerPage.request.get(
        `/api/anamnesis/reports/${reportId}/file?${trainerQuery}`,
      )
    ).status(),
  ).toBe(403);
  await trainerPage.goto('/anamnesis');
  await expect(trainerPage.getByTestId('anamnesis-page')).toBeVisible();
  await expect(
    trainerPage.getByRole('link', { name: 'Загрузить PDF', exact: true }),
  ).toHaveCount(0);

  // Грант на показатель открывает только его.
  const grant = await page.request.put(
    `/api/anamnesis/access/markers/vitamin-d-25oh?${ownerQuery}`,
    { headers: { origin }, data: { trainerId: trainer.id, enabled: true } },
  );
  expect(grant.status()).toBe(204);
  const grantedMarkers = (await (
    await trainerPage.request.get(`/api/anamnesis/markers?${trainerQuery}`)
  ).json()) as MarkerSummary[];
  expect(grantedMarkers.map((summary) => summary.marker.id)).toEqual([
    'vitamin-d-25oh',
  ]);
  // Отчёт остаётся закрытым: в нём показатель без гранта не участвует,
  // но доступ к скачиванию требует полного покрытия — здесь только один из одного.
  expect(
    (
      await trainerPage.request.get(
        `/api/anamnesis/reports/${reportId}/file?${trainerQuery}`,
      )
    ).status(),
  ).toBe(200);

  // Грант на документ открывает оригинал — отдельно от показателей.
  const documentGrant = await page.request.put(
    `/api/anamnesis/access/documents/${document.document.id}?${ownerQuery}`,
    { headers: { origin }, data: { trainerId: trainer.id, enabled: true } },
  );
  expect(documentGrant.status()).toBe(204);
  const trainerFile = await trainerPage.request.get(
    `/api/anamnesis/documents/${document.document.id}/file?${trainerQuery}`,
  );
  expect(trainerFile.status()).toBe(200);
  expect(trainerFile.headers()['content-type']).toBe('application/pdf');

  // Отзыв гранта на показатель немедленно закрывает отчёт.
  await page.request.put(
    `/api/anamnesis/access/markers/vitamin-d-25oh?${ownerQuery}`,
    { headers: { origin }, data: { trainerId: trainer.id, enabled: false } },
  );
  expect(
    (
      await trainerPage.request.get(
        `/api/anamnesis/reports/${reportId}/file?${trainerQuery}`,
      )
    ).status(),
  ).toBe(403);

  const deniedPreview = await trainerPage.request.post(
    `/api/anamnesis/reports/preview?${trainerQuery}`,
    {
      headers: { origin },
      data: { markerIds: ['vitamin-d-25oh'], dateKeys: null },
    },
  );
  expect(deniedPreview.status()).toBe(403);
  const deniedDates = await trainerPage.request.post(
    `/api/anamnesis/reports/dates?${trainerQuery}`,
    {
      headers: { origin },
      data: { markerIds: ['vitamin-d-25oh'], dateKeys: null },
    },
  );
  expect(deniedDates.status()).toBe(403);
  const stale = await page.request.post(
    `/api/anamnesis/reports?${ownerQuery}`,
    {
      headers: { origin },
      data: {
        markerIds: ['vitamin-d-25oh'],
        dateKeys: null,
        snapshotKey: '0'.repeat(64),
      },
    },
  );
  expect(stale.status()).toBe(409);
  // A real data revision invalidates an earlier preview, even when selection is unchanged.
  const observationsResponse = await page.request.get(
    `/api/anamnesis/markers/vitamin-d-25oh/observations?${ownerQuery}`,
  );
  const observations = (await observationsResponse.json()) as Array<
    import('../../src/contracts/anamnesis').MedicalObservation
  >;
  const observation = observations[0]!;
  const changedMonth =
    observation.collectedAt === '2026-08' ? '2026-07' : '2026-08';
  const changed = await page.request.patch(
    `/api/anamnesis/observations/${observation.id}?${ownerQuery}`,
    {
      headers: { origin },
      data: {
        expectedRevision: observation.revision,
        markerId: observation.markerId,
        value: observation.value,
        originalUnit: observation.originalUnit,
        collectedAt: changedMonth,
        datePrecision: 'month',
        referenceRange: observation.referenceRange,
      },
    },
  );
  expect(changed.status()).toBe(200);
  const outdated = await page.request.post(
    `/api/anamnesis/reports?${ownerQuery}`,
    {
      headers: { origin },
      data: {
        markerIds: ['vitamin-d-25oh'],
        dateKeys: null,
        snapshotKey: singlePreview.snapshotKey,
      },
    },
  );
  expect(outdated.status()).toBe(409);
  const availableDates = await page.request.post(
    `/api/anamnesis/reports/dates?${ownerQuery}`,
    {
      headers: { origin },
      data: { markerIds: ['vitamin-d-25oh'], dateKeys: null },
    },
  );
  expect(await availableDates.json()).toContainEqual({
    key: changedMonth,
    count: 1,
  });
  // Unknown precision stays an undated group; the UI must not invent a day.
  const dateFixture = new Database('.data/e2e.sqlite');
  try {
    dateFixture
      .prepare(
        "UPDATE medical_observations SET collected_at=NULL,date_precision='unknown',revision=revision+1 WHERE id=? AND owner_id=?",
      )
      .run(observation.id, owner.id);
  } finally {
    dateFixture.close();
  }
  await page.reload();
  await allHistory.uncheck();
  await expect(
    builder.getByRole('checkbox', { name: 'Без даты (1)', exact: true }),
  ).toBeChecked();
  await expect(generate).toBeEnabled({ timeout: 30000 });
  // Delayed previews cannot overwrite the latest selection; denial clears both preview and saved files.
  const oldHtml = await builder
    .locator('iframe')
    .first()
    .getAttribute('srcdoc');
  let releaseOld!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  let previewRequests = 0;
  await page.route('**/api/anamnesis/reports/preview?*', async (route) => {
    const index = ++previewRequests;
    if (index === 1) await held;
    await route.fulfill({
      status: 200,
      json: {
        html: `<p id="preview-version">${index}</p>`,
        pageCount: 1,
        snapshotKey: '1'.repeat(64),
      },
    });
  });
  expect(oldHtml).toContain('report-pages');
  await alt.uncheck();
  await expect.poll(() => previewRequests).toBe(1);
  await ast.uncheck();
  await expect(
    page
      .frameLocator('iframe[title="Предпросмотр"]')
      .locator('#preview-version'),
  ).toHaveText('2');
  releaseOld();
  await expect(
    page
      .frameLocator('iframe[title="Предпросмотр"]')
      .locator('#preview-version'),
  ).toHaveText('2');
  await page.unroute('**/api/anamnesis/reports/preview?*');
  await page.route('**/api/anamnesis/reports/preview?*', (route) =>
    route.fulfill({ status: 403, json: { error: 'FORBIDDEN' } }),
  );
  await alt.check();
  await expect(builder.locator('iframe')).toHaveCount(0);
  await expect(builder.getByRole('alert')).toBeVisible();
  await trainerContext.close();
});
