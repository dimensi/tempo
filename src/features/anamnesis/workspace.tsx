'use client';
import { PageHeader } from '@/components/layout/page-header';
import { SectionNavigation } from '@/components/shared/section-navigation';
import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { Alert, Group, Stack, Text } from '@mantine/core';
import { ownerIdQuery } from './api';
import { DocumentsPanel } from './documents-panel';
import { MarkerTable } from './marker-table';
import { ReportsPanel } from './reports-panel';
const sections = [
  { id: 'markers', label: m.workspace.markers },
  { id: 'documents', label: m.workspace.documents },
  { id: 'export', label: m.workspace.export },
];
export function AnamnesisWorkspace({
  ownerId,
  writable,
}: {
  ownerId: string;
  writable: boolean;
}) {
  const resource = useReadResource(
    readResources.anamnesis(`/api/anamnesis/overview?${ownerIdQuery(ownerId)}`),
  );
  const overview = resource.data;
  const error = resource.error;
  return (
    <Stack data-testid="anamnesis-page">
      <PageHeader>{m.title}</PageHeader>
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
