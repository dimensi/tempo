import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
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
  let response = await signInRequest();
  if (response.status() === 429) {
    const seconds = Number(
      response.headers()['x-retry-after'] ??
        response.headers()['retry-after'] ??
        10,
    );
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    response = await signInRequest();
  }
  expect(response.ok()).toBe(true);
  return (await getSessionWith429Retry(page.request)).user;
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

  // Тренер получает доступ через настоящее приглашение (trainer_access).
  const trainerEmail = `anamnesis-${test.info().project.name}@example.test`;
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

  // Загрузка контрольного документа «Синтетическая лаборатория».
  const upload = await page.request.post(
    `/api/anamnesis/documents/uploads?${ownerQuery}`,
    {
      headers: { origin },
      multipart: {
        file: {
          name: 'synthetic-lab.pdf',
          mimeType: 'application/pdf',
          buffer: fixturePdf(),
        },
      },
    },
  );
  expect(upload.status()).toBe(201);
  const document = (await upload.json()) as {
    document: { id: string; pageCount: number };
    duplicate: boolean;
  };
  expect(document.duplicate).toBe(false);
  expect(document.document.pageCount).toBe(3);

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
  expect(((await duplicate.json()) as { duplicate: boolean }).duplicate).toBe(
    true,
  );

  // Фоновый импорт завершается; ТЗ §9 — шесть измерений, пять показателей.
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
  await page.goto('/anamnesis');
  await expect(page.getByTestId('anamnesis-overview')).toBeVisible();
  await page.goto('/anamnesis/markers');
  await expect(page.getByTestId('anamnesis-marker-table')).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Витамин D (25-OH)' }),
  ).toBeVisible();

  // Отчёт генерируется и скачивается.
  const report = await page.request.post(
    `/api/anamnesis/reports?${ownerQuery}`,
    {
      headers: { origin },
      data: { markerIds: ['vitamin-d-25oh'], from: null, to: null },
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
  await expect(trainerPage.getByTestId('anamnesis-overview')).toBeVisible();

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

  await trainerContext.close();
});
