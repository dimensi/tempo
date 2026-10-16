'use client';
import { SectionNavigation } from '@/components/shared/section-navigation';
import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import type { AnamnesisOverview } from '@/contracts/anamnesis';
import { readResources } from '@/lib/read-descriptors';
import { useReadRefresh } from '@/lib/use-read-refresh';
import { useReadResource } from '@/lib/use-read-resource';
import { Alert, Group, Stack, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { fetchAnamnesis, ownerIdQuery } from './api';
import { DocumentsPanel } from './documents-panel';
import { MarkerTable } from './marker-table';
import { useAnamnesisRevision } from './refresh';
import { ReportsPanel } from './reports-panel';
const sections = [
  { id: 'markers', label: m.workspace.markers },
  { id: 'documents', label: m.workspace.documents },
  { id: 'export', label: m.workspace.export },
];
export function AnamnesisWorkspace({
  ownerId,
  writable,
  initial,
}: {
  ownerId: string;
  writable: boolean;
  initial: AnamnesisOverview;
}) {
  const [overview, setOverview] = useState<AnamnesisOverview | null>(initial);
  const [error, setError] = useState(false);
  const readRefresh = useReadRefresh();
  const revision = useAnamnesisRevision();
  const readResource1 = useReadResource(
    readResources.anamnesis(`/api/anamnesis/overview?${ownerIdQuery(ownerId)}`),
  );
  const [acceptedreadResource1, setAcceptedreadResource1] =
    useState<typeof readResource1.data>();
  if (
    readResource1.data !== undefined &&
    acceptedreadResource1 !== readResource1.data
  ) {
    setAcceptedreadResource1(readResource1.data);
    setOverview(readResource1.data);
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetchAnamnesis<AnamnesisOverview>(
      `/api/anamnesis/overview?${ownerIdQuery(ownerId)}`,
      { signal: controller.signal, cache: 'no-store' },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setOverview(result);
          setError(false);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          if (
            cause instanceof Error &&
            'status' in cause &&
            [401, 403].includes(Number(cause.status))
          )
            setOverview(null);
          setError(true);
        }
      });
    return () => controller.abort();
  }, [ownerId, revision, readRefresh]);
  return (
    <Stack data-testid="anamnesis-page">
      <Title order={1}>{m.title}</Title>
      {error && <Alert color="red">{m.errors.load}</Alert>}
      {overview && (
        <Group gap="md" aria-label={m.overview.title}>
          <Text size="sm">
            {m.documents.title}: {overview.documents} · {m.markers.title}:{' '}
            {overview.markers} · {m.overview.observations}:{' '}
            {overview.observations}
          </Text>
          <a
            href={
              overview.pendingDocumentId
                ? `#document-${overview.pendingDocumentId}`
                : '#documents'
            }
          >
            {m.overview.pendingReviews}: {overview.pendingReviews}
          </a>
          <a
            href={
              overview.activeDocumentId
                ? `#document-${overview.activeDocumentId}`
                : '#documents'
            }
          >
            {m.overview.activeImports}: {overview.activeImports}
          </a>
        </Group>
      )}
      <SectionNavigation sections={sections} label={m.workspace.navigation}>
        <Stack gap={48}>
          <section id="markers" tabIndex={-1}>
            <MarkerTable ownerId={ownerId} />
          </section>
          <section id="documents" tabIndex={-1}>
            <DocumentsPanel ownerId={ownerId} writable={writable} />
          </section>
          <section id="export" tabIndex={-1}>
            <ReportsPanel ownerId={ownerId} />
          </section>
        </Stack>
      </SectionNavigation>
    </Stack>
  );
}
