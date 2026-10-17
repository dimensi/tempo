'use client';
import { useEffect, useState } from 'react';
import { useDebouncedValue } from '@mantine/hooks';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Select,
} from '@mantine/core';
import type { WorkoutExercise } from '@/contracts/workouts';
import type { TransformMateCatalogItem } from '@/contracts/transformmate';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { apiFetch } from '@/lib/api-client';
import { apiResults } from '@/lib/api-results';
import { ExercisePreview } from './exercise-preview';
import { selectCatalogExercise } from './transformmate-exercises';
import { workoutMessages as m } from './messages';
import styles from './day-workout.module.css';

export function ExercisePicker({
  ownerId,
  capacity,
  onAdd,
}: {
  ownerId: string;
  capacity: number;
  onAdd: (items: WorkoutExercise[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 250);
  const [muscle, setMuscle] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [groups, setGroups] = useState<string[]>([]);
  useEffect(() => {
    if (!filterOpen) return;
    const controller = new AbortController();
    void apiFetch(
      `/api/workouts/transformmate/muscle-groups?ownerId=${encodeURIComponent(ownerId)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return apiResults.muscles((await response.json()).data);
      })
      .then((dictionary) => {
        if (!controller.signal.aborted)
          setGroups([...new Set(dictionary.groups.map((group) => group.name))]);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [ownerId, filterOpen]);
  const [offset, setOffset] = useState(0);
  const [chosen, setChosen] = useState<TransformMateCatalogItem[]>([]);
  const params = new URLSearchParams({
    ownerId,
    q: debounced,
    offset: String(offset),
    limit: '20',
  });
  if (muscle) params.set('muscleGroup', muscle);
  const read = useReadResource(
    readResources.catalog(`/api/workouts/transformmate/exercises?${params}`),
  );
  const empty = (name = ''): WorkoutExercise => ({
    id: crypto.randomUUID(),
    name,
    sets: [{ reps: 10, weightKg: null }],
  });
  return (
    <Stack gap="md">
      <TextInput
        data-autofocus
        label={m.searchExercises}
        placeholder={m.searchHint}
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
          setOffset(0);
        }}
      />
      <Button
        variant="subtle"
        size="compact-sm"
        mih={44}
        onClick={() => setFilterOpen(!filterOpen)}
        aria-expanded={filterOpen}
      >
        {m.filters}
      </Button>
      <Collapse expanded={filterOpen}>
        <Select
          label={m.muscleGroups}
          searchable
          clearable
          data={groups}
          value={muscle}
          onChange={(value) => {
            setMuscle(value ?? '');
            setOffset(0);
          }}
        />
      </Collapse>
      {read.error && (
        <Alert color="orange">
          {m.catalogError}
          <Button variant="subtle" onClick={() => void read.refresh()}>
            {m.refresh}
          </Button>
        </Alert>
      )}
      {!read.data && !read.error && <Loader size="sm" />}
      {read.data?.data.length === 0 && <Text c="dimmed">{m.catalogEmpty}</Text>}
      <Stack gap={0}>
        {read.data?.data.map((item) => {
          const checked = chosen.some((value) => value.id === item.id);
          const disabled =
            !item.canPlan ||
            item.name.length > 160 ||
            (!checked && chosen.length >= capacity);
          return (
            <label key={item.id} className={styles.pickerRow}>
              <ExercisePreview ownerId={ownerId} item={item} />
              <span className={styles.pickerName}>
                {item.name}
                {disabled && !checked && (
                  <Text size="xs" c="dimmed">
                    {m.catalogReadOnly}
                  </Text>
                )}
              </span>
              <Checkbox
                aria-label={item.name}
                checked={checked}
                disabled={disabled}
                onChange={() =>
                  setChosen(
                    checked
                      ? chosen.filter((value) => value.id !== item.id)
                      : [...chosen, item],
                  )
                }
              />
            </label>
          );
        })}
      </Stack>
      <Group justify="space-between">
        {offset > 0 && (
          <Button
            variant="subtle"
            mih={44}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            {m.catalogPrevious}
          </Button>
        )}
        {read.data?.catalog.hasMore && (
          <Button
            variant="subtle"
            mih={44}
            onClick={() => setOffset(offset + 20)}
          >
            {m.moreExercises}
          </Button>
        )}
      </Group>
      {query.trim() && query.trim().length <= 160 && (
        <Button
          variant="default"
          mih={44}
          disabled={capacity < 1}
          onClick={() => onAdd([empty(query.trim())])}
        >
          {m.manualChoice}: {query.trim()}
        </Button>
      )}
      <div className={styles.pickerFooter}>
        <Button
          fullWidth
          mih={44}
          disabled={!chosen.length}
          onClick={() =>
            onAdd(chosen.map((item) => selectCatalogExercise(empty(), item)))
          }
        >
          {m.addSelected}
          {chosen.length ? ` · ${chosen.length}` : ''}
        </Button>
      </div>
    </Stack>
  );
}
