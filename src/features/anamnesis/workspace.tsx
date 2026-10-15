'use client';
import { useReadResource } from '@/lib/use-read-resource';
import { anamnesisOverviewSchema } from '@/contracts/anamnesis';
import { useReadRefresh } from '@/lib/use-read-refresh';
import { useEffect, useState } from 'react';
import { Alert, Group, Stack, Text, Title } from '@mantine/core';
import { SectionNavigation } from '@/components/shared/section-navigation';
import type { AnamnesisOverview } from '@/contracts/anamnesis';
import { MarkerTable } from './marker-table';
import { DocumentsPanel } from './documents-panel';
import { ReportsPanel } from './reports-panel';
import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import { fetchAnamnesis, ownerIdQuery } from './api';
import { useAnamnesisRevision } from './refresh';
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
  useReadResource(
    `/api/anamnesis/overview?${ownerIdQuery(ownerId)}`,
    (value) => anamnesisOverviewSchema.parse(value),
    setOverview,
  );
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
