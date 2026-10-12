'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Loader, Stack, Text, TextInput } from '@mantine/core';
import { z } from 'zod';
import {
  transformMateCatalogItemSchema,
  transformMateExerciseInfoSchema,
  type TransformMateCatalogItem,
  type TransformMateExerciseInfo,
} from '@/contracts/transformmate';
import type { WorkoutExercise } from '@/contracts/workouts';
import { workoutMessages as m } from './messages';
import { TeachingVideo } from './teaching-video';
export function Catalog({
  ownerId,
  exercise,
  onSelect,
  searchable = true,
}: {
  ownerId: string;
  exercise: WorkoutExercise;
  onSelect: (item: TransformMateCatalogItem) => void;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<TransformMateCatalogItem[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [info, setInfo] = useState<TransformMateExerciseInfo | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [video, setVideo] = useState(false);
  const selected = exercise.transformMate?.exerciseId;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!query.trim()) return;
      void fetch(
        `/api/workouts/transformmate/exercises?ownerId=${encodeURIComponent(ownerId)}&q=${encodeURIComponent(query)}`,
        { signal: controller.signal, cache: 'no-store' },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const result = await response.json();
          const data = z
            .array(transformMateCatalogItemSchema)
            .parse(result.data.items);
          if (!controller.signal.aborted) {
            setItems(data);
            setState('ready');
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setItems([]);
            setState('error');
          }
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, ownerId]);
  useEffect(() => {
    const controller = new AbortController();
    if (selected)
      void fetch(
        `/api/workouts/transformmate/exercises/${selected}?ownerId=${encodeURIComponent(ownerId)}`,
        { signal: controller.signal, cache: 'no-store' },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const result = await response.json();
          const data = transformMateExerciseInfoSchema.parse(result.data);
          if (data.id !== selected) throw new Error();
          if (!controller.signal.aborted) setInfo(data);
        })
        .catch(() => {
          if (!controller.signal.aborted) setDetailError(true);
        });
    return () => controller.abort();
  }, [selected, ownerId]);
  return (
    <Stack gap="xs">
      <Text size="sm" c="var(--mantine-color-text)">
        {selected ? m.linked : searchable ? m.catalogPrompt : m.manual}
      </Text>
      {searchable && (
        <TextInput
          label={m.catalog}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setItems([]);
            setState(event.currentTarget.value.trim() ? 'loading' : 'idle');
          }}
        />
      )}
      {state === 'loading' && <Loader size="sm" aria-label={m.loading} />}
      {state === 'error' && (
        <Alert color="red" role="alert">
          {m.catalogError}
        </Alert>
      )}
      {state === 'ready' && items.length === 0 && (
        <Text role="status">{m.catalogEmpty}</Text>
      )}
      {items.map((item) => (
        <Button
          key={item.id}
          mih={44}
          variant="light"
          disabled={!item.canPlan || item.name.length > 160}
          onClick={() => {
            onSelect(item);
            setQuery('');
          }}
          style={{ height: 'auto', whiteSpace: 'normal' }}
        >
          {item.name}
          {!item.canPlan && ` — ${m.unsupported}`}
        </Button>
      ))}
      {detailError && (
        <Alert role="alert" color="red">
          {m.catalogError}
        </Alert>
      )}
      {info && !info.canPlan && <Alert>{m.unsupported}</Alert>}
      {info?.description && (
        <Text
          size="sm"
          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {info.description}
        </Text>
      )}
      {info?.hasVideo && (
        <Button variant="subtle" mih={44} onClick={() => setVideo(!video)}>
          {video ? m.hideVideo : m.video}
        </Button>
      )}
      {video && selected && (
        <TeachingVideo
          key={`${ownerId}-${selected}`}
          src={`/api/workouts/transformmate/exercises/${selected}/video?ownerId=${encodeURIComponent(ownerId)}`}
        />
      )}
    </Stack>
  );
}
