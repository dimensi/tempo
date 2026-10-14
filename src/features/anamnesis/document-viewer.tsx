'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import type {
  MedicalDocument,
  MedicalImportJob,
  MedicalObservation,
  MedicalObservationSource,
} from '@/contracts/anamnesis';
import { anamnesisMessages as m } from './messages';
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
  const [document, setDocument] = useState<MedicalDocument>();
  const [sources, setSources] = useState<
    Array<{ observation: MedicalObservation; source: MedicalObservationSource }>
  >([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const query = ownerIdQuery(ownerId);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await fetchAnamnesis<MedicalDocument>(
          `/api/anamnesis/documents/${documentId}?${query}`,
        );
        if (active) setDocument(loaded);
        const reviews = await fetchAnamnesis<
          Array<{
            observation: MedicalObservation;
            sources: MedicalObservationSource[];
          }>
        >(`/api/anamnesis/reviews?${query}`).catch(() => []);
        if (active)
          setSources(
            reviews.flatMap((review) =>
              review.sources
                .filter((source) => source.documentId === documentId)
                .map((source) => ({ observation: review.observation, source })),
            ),
          );
      } catch {
        if (active) setError(m.errors.load);
      }
    })();
    return () => {
      active = false;
    };
  }, [documentId, query]);

  async function reprocess() {
    setBusy(true);
    setError(undefined);
    try {
      await fetchAnamnesis<MedicalImportJob>(
        `/api/anamnesis/documents/${documentId}/reprocess?${query}`,
        { method: 'POST' },
      );
    } catch {
      setError(m.errors.save);
    } finally {
      setBusy(false);
    }
  }

  if (error)
    return (
      <Stack data-testid="anamnesis-document-viewer">
        <Title order={1}>{m.documents.title}</Title>
        <Alert color="red" role="alert">
          {error}
        </Alert>
      </Stack>
    );

  return (
    <Stack data-testid="anamnesis-document-viewer">
      <Title order={1}>{document?.filename ?? '…'}</Title>
      {document && (
        <Paper withBorder p="md">
          <Group>
            <Text size="sm" c="dimmed">
              {document.laboratoryName ?? '—'} ·{' '}
              {formatAnamnesisDate(document.collectedAt ?? document.issuedAt)} ·{' '}
              {document.pageCount} стр.
            </Text>
            <a
              href={`/api/anamnesis/documents/${documentId}/file?${query}`}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="default" mih={44}>
                {m.documents.download}
              </Button>
            </a>
            {writable && (
              <Button
                variant="light"
                mih={44}
                loading={busy}
                onClick={() => void reprocess()}
              >
                {m.documents.reprocess}
              </Button>
            )}
          </Group>
        </Paper>
      )}
      {document && (
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
