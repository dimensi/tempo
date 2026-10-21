'use client';
import { PageHeader } from '@/components/layout/page-header';
import { OfflineFile } from '@/components/shared/offline-file';
import { offlineMessages } from '@/config/offline';
import { readResources } from '@/lib/read-descriptors';
import { useReadOnline } from '@/lib/use-read-online';
import { useReadResource } from '@/lib/use-read-resource';

import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import type { MedicalImportJob } from '@/contracts/anamnesis';
import { Alert, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { fetchAnamnesis, formatAnamnesisDate, ownerIdQuery } from './api';

// Просмотр оригинала: PDF встроен через авторизованный маршрут API,
// публичных ссылок нет. Происхождение измерений — цитаты с номерами страниц.
export function DocumentViewer({
  ownerId,
  documentId,
  writable,
}: {
  ownerId: string;
  documentId: string;
  writable: boolean;
}) {
  const online = useReadOnline();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const query = ownerIdQuery(ownerId);
  const documentRead = useReadResource(
    readResources.document(`/api/anamnesis/documents/${documentId}?${query}`),
  );
  const observationsRead = useReadResource(
    readResources.documentObservations(
      `/api/anamnesis/documents/${documentId}/observations?${query}`,
    ),
  );
  const importsRead = useReadResource(
    readResources.anamnesisImports(`/api/anamnesis/imports?${query}`),
  );
  const job = importsRead.data?.find((item) => item.documentId === documentId);
  const importActive = job?.status === 'queued' || job?.status === 'processing';
  const refreshImports = importsRead.refresh;
  const refreshDocument = documentRead.refresh;
  const refreshObservations = observationsRead.refresh;
  const completedImport =
    job && ['completed', 'completed_with_warnings'].includes(job.status)
      ? `${job.id}:${job.updatedAt}`
      : null;
  useEffect(() => {
    if (!online || !importActive) return;
    const timer = setInterval(() => void refreshImports(), 2000);
    return () => clearInterval(timer);
  }, [online, importActive, refreshImports]);
  useEffect(() => {
    if (!completedImport) return;
    void refreshDocument();
    void refreshObservations();
  }, [completedImport, refreshDocument, refreshObservations]);
  const document = documentRead.data;
  const sources = (observationsRead.data ?? []).flatMap((review) =>
    review.sources
      .filter((source) => source.documentId === documentId)
      .map((source) => ({ observation: review.observation, source })),
  );
  const loadError = documentRead.error || observationsRead.error;

  async function reprocess() {
    setBusy(true);
    setError(undefined);
    try {
      await fetchAnamnesis<MedicalImportJob>(
        `/api/anamnesis/documents/${documentId}/reprocess?${query}`,
        { method: 'POST' },
      );
      await importsRead.refresh();
    } catch {
      setError(m.errors.save);
    } finally {
      setBusy(false);
    }
  }

  if ((error || loadError) && !document)
    return (
      <Stack data-testid="anamnesis-document-viewer">
        <PageHeader>{m.documents.title}</PageHeader>
        <Alert color="red" role="alert">
          {error ?? m.errors.load}
        </Alert>
      </Stack>
    );

  return (
    <Stack data-testid="anamnesis-document-viewer">
      <a href="/anamnesis#documents">
        {m.title} · {m.workspace.documents}
      </a>
      <PageHeader>{document?.filename ?? '…'}</PageHeader>
      {(error || loadError) && (
        <Alert color="red" role="alert">
          {error ?? m.errors.load}
        </Alert>
      )}
      {document && (
        <Paper withBorder p="md">
          <Group>
            <Text size="sm" c="dimmed">
              {document.laboratoryName ?? '—'} ·{' '}
              {formatAnamnesisDate(document.collectedAt ?? document.issuedAt)} ·{' '}
              {document.pageCount} стр.
            </Text>
            {online && (
              <a
                href={`/api/anamnesis/documents/${documentId}/file?${query}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="default" mih={44}>
                  {m.documents.download}
                </Button>
              </a>
            )}
            {writable && (
              <Button
                variant="light"
                mih={44}
                disabled={!online || importActive}
                loading={busy}
                onClick={() => void reprocess()}
              >
                {m.documents.reprocess}
              </Button>
            )}
          </Group>
        </Paper>
      )}
      {job && (
        <Text role="status">
          {m.imports.status[job.status]} · {m.imports.stage[job.stage]}
        </Text>
      )}
      {!!job?.failedPages.length && (
        <Alert color="yellow" role="status">
          {m.imports.partialPages}{' '}
          {job.failedPages.map((page) => page.pageNumber).join(', ')}.{' '}
          {m.imports.partialHint}
        </Alert>
      )}
      {document && (
        <OfflineFile
          id={`medical-document:${document.id}`}
          label={document.filename}
          kind="pdf"
          size={document.sizeBytes}
          href={`/api/anamnesis/documents/${documentId}/file?${query}`}
          offline={!online}
        />
      )}
      {!online && <Text c="dimmed">{offlineMessages.fileRequiresSave}</Text>}
      {document && online && (
        <Paper withBorder style={{ height: '70vh' }}>
          <object
            data={`/api/anamnesis/documents/${documentId}/file?${query}`}
            type="application/pdf"
            width="100%"
            height="100%"
            aria-label={document.filename}
          >
            <Text p="md">{m.documents.download}</Text>
          </object>
        </Paper>
      )}
      {!!sources.length && (
        <>
          <Title order={2}>{m.documents.sources}</Title>
          <Stack>
            {sources.map(({ observation, source }) => (
              <Paper key={source.id} withBorder p="sm">
                <Text size="sm">
                  {observation.originalName} ·{' '}
                  {formatAnamnesisDate(observation.collectedAt)} ·{' '}
                  {m.documents.sourceQuote}: стр. {source.pageNumber}
                </Text>
                <Text size="sm" c="dimmed" fs="italic">
                  «{source.rawText}»
                </Text>
              </Paper>
            ))}
          </Stack>
        </>
      )}
    </Stack>
  );
}
