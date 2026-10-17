'use client';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import {
  Alert,
  Button,
  Drawer,
  Group,
  Stack,
  UnstyledButton,
} from '@mantine/core';
import { useViewState } from '@/lib/use-view-state';
import { useRouter, useSearchParams } from 'next/navigation';
import { CatalogReadContent } from './catalog-read';
import { ExerciseDetails } from './exercise-details';
import { workoutMessages as m } from './messages';
function CatalogDetails({
  ownerId,
  id,
  name,
}: {
  ownerId: string;
  id: number;
  name: string;
}) {
  const [open, setOpen] = useViewState(
    `catalog:${ownerId}:${id}:details`,
    false,
  );
  return (
    <Stack gap="xs">
      <UnstyledButton
        style={{ minHeight: 44, fontSize: 17, fontWeight: 650 }}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {name}
      </UnstyledButton>
      {open && (
        <Drawer
          opened
          onClose={() => setOpen(false)}
          title={name}
          position="right"
          size="min(480px, 100vw)"
        >
          <ExerciseDetails ownerId={ownerId} exerciseId={id} />
        </Drawer>
      )}
    </Stack>
  );
}
export function CatalogPage({ ownerId }: { ownerId: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const setOffset = (next: number) => {
    const query = new URLSearchParams(params.toString());
    query.set('offset', String(next));
    router.push(`/workouts/catalog?${query}`, { scroll: false });
  };
  const read = useReadResource(
    readResources.catalog(
      `/api/workouts/transformmate/exercises?${new URLSearchParams({ ownerId, offset: String(offset), limit: '50' })}`,
    ),
  );
  const current = read.data;
  const failed = !!read.error;
  return (
    <Stack>
      {failed && !current && <Alert color="orange">{m.catalogError}</Alert>}
      {!current && !failed && <Alert role="status">{m.loading}</Alert>}
      {current && (
        <CatalogReadContent
          partialLabel={m.catalogPageCoverage}
          items={current.data.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.snippet,
            muscleGroups: item.muscleGroups.map((group) => group.name),
            fetchedAt: item.detailFetchedAt ?? item.fetchedAt,
            hasVideo: false,
          }))}
          complete={
            current.catalog.coverage === 'complete' &&
            !current.catalog.hasMore &&
            offset === 0
          }
          renderDetails={(id, name) => (
            <CatalogDetails key={id} ownerId={ownerId} id={id} name={name} />
          )}
        />
      )}
      <Group>
        <Button
          variant="default"
          mih={44}
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          {m.catalogPrevious}
        </Button>
        <Button
          variant="default"
          mih={44}
          disabled={!current?.catalog.hasMore}
          onClick={() => setOffset(offset + 50)}
        >
          {m.catalogNext}
        </Button>
      </Group>
    </Stack>
  );
}
