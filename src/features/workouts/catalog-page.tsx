'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Group, Stack } from '@mantine/core';
import {
  transformMateCatalogResultSchema,
  type TransformMateCatalogResult,
} from '@/contracts/transformmate';
import { CatalogReadContent } from './catalog-read';
import { ExerciseDetails } from './exercise-details';
import { workoutMessages as m } from './messages';
function CatalogDetails({ ownerId, id }: { ownerId: string; id: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap="xs">
      <Button
        variant="subtle"
        mih={44}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {m.view}
      </Button>
      {open && <ExerciseDetails ownerId={ownerId} exerciseId={id} />}
    </Stack>
  );
}
export function CatalogPage({ ownerId }: { ownerId: string }) {
  const [offset, setOffset] = useState(0);
  const [resource, setResource] = useState<{
    offset: number;
    data: TransformMateCatalogResult;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const pending = new AbortController();
    void fetch(
      `/api/workouts/transformmate/exercises?${new URLSearchParams({ ownerId, offset: String(offset), limit: '50' })}`,
      { signal: pending.signal, cache: 'no-store' },
    )
      .then(async (response) => {
        if (!response.ok) throw Error();
        return transformMateCatalogResultSchema.parse(await response.json());
      })
      .then((data) => {
        if (!pending.signal.aborted) {
          setResource({ offset, data });
          setFailed(false);
        }
      })
      .catch(() => {
        if (!pending.signal.aborted) setFailed(true);
      });
    return () => pending.abort();
  }, [ownerId, offset]);
  const current = resource?.offset === offset ? resource.data : null;
  return (
    <Stack>
      {failed && <Alert color="orange">{m.catalogError}</Alert>}
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
          renderDetails={(id) => (
            <CatalogDetails key={id} ownerId={ownerId} id={id} />
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
