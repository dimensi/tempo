'use client';
import {
  type TransformMateCatalogItem,
  type TransformMateCatalogMetadata,
  type TransformMateMuscleDictionary,
} from '@/contracts/transformmate';
import type { WorkoutExercise } from '@/contracts/workouts';
import { apiFetch } from '@/lib/api-client';
import { apiResults } from '@/lib/api-results';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  Group,
  Loader,
  MultiSelect,
  Select,
  Stack,
  Text,
  TextInput,
  useCombobox,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { ExerciseDetails } from './exercise-details';
import { ExercisePreview } from './exercise-preview';
import { workoutMessages as m } from './messages';

export function Catalog({
  ownerId,
  exercise,
  onSelect,
  onManual,
  showDetails = true,
  label = m.exercise,
  required = true,
}: {
  ownerId: string;
  exercise: WorkoutExercise;
  onSelect: (item: TransformMateCatalogItem) => void;
  onManual?: (name: string) => void;
  showDetails?: boolean;
  label?: string;
  required?: boolean;
}) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });
  const [inspecting, setInspecting] = useState<number | null>(null);
  const [query, setQuery] = useState(exercise.name);
  const [searching, setSearching] = useState(false);
  const [items, setItems] = useState<TransformMateCatalogItem[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [dictionary, setDictionary] =
    useState<TransformMateMuscleDictionary | null>(null);
  const [dictionaryError, setDictionaryError] = useState(false);
  const [commonGroup, setCommonGroup] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [metadata, setMetadata] = useState<TransformMateCatalogMetadata | null>(
    null,
  );
  useEffect(() => {
    if (!searching || dictionary) return;
    const controller = new AbortController();
    void apiFetch(
      `/api/workouts/transformmate/muscle-groups?ownerId=${encodeURIComponent(ownerId)}`,
      { signal: controller.signal, cache: 'no-store' },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return apiResults.muscles((await response.json()).data);
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setDictionary(data);
          setDictionaryError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setDictionaryError(true);
      });
    return () => controller.abort();
  }, [ownerId, searching, dictionary]);
  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        ownerId,
        q: query,
        offset: String(offset),
        limit: '20',
      });
      if (commonGroup) params.set('commonMuscleGroup', commonGroup);
      groups.forEach((group) => params.append('muscleGroup', group));
      const url = `/api/workouts/transformmate/exercises?${params}`;
      void apiFetch(url, { signal: controller.signal, cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const result = await response.json();
          const data = apiResults.catalog(result);
          if (!controller.signal.aborted) {
            setItems(data.data);
            setMetadata(data.catalog);
            // One bounded enrichment request for this result page; the server limits concurrency to two.
            const visible = data.data
              .filter((item) => item.detailCoverage === 'unknown')
              .slice(0, 6);
            if (visible.length) {
              visible.forEach((item) =>
                params.append('visible', String(item.id)),
              );
              void apiFetch(`/api/workouts/transformmate/exercises?${params}`, {
                signal: controller.signal,
                cache: 'no-store',
              })
                .then(async (response) => {
                  if (!response.ok) throw new Error();
                  return apiResults.catalog(await response.json());
                })
                .then((enriched) => {
                  if (!controller.signal.aborted) {
                    setItems(enriched.data);
                    setMetadata(enriched.catalog);
                  }
                })
                .catch(() => {});
            }
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
  }, [query, ownerId, searching, commonGroup, groups, offset]);
  return (
    <Stack gap="xs">
      <Stack gap="xs" onFocusCapture={() => setSearching(true)}>
        <Group grow align="start">
          <Select
            searchable
            label={m.muscleCommon}
            nothingFoundMessage={
              dictionaryError
                ? m.catalogError
                : dictionary
                  ? m.filtersEmpty
                  : m.filtersLoading
            }
            rightSection={
              searching && !dictionary && !dictionaryError ? (
                <Loader size={16} />
              ) : undefined
            }
            value={commonGroup}
            clearable
            data={[
              ...new Set(
                (dictionary?.groups ?? []).map(
                  (group) => group.commonGroup.name,
                ),
              ),
            ]}
            onChange={(value) => {
              setCommonGroup(value);
              setGroups([]);
              setOffset(0);
              setSearching(true);
            }}
          />
          <MultiSelect
            searchable
            label={m.muscleGroups}
            nothingFoundMessage={
              dictionaryError
                ? m.catalogError
                : dictionary
                  ? m.filtersEmpty
                  : m.filtersLoading
            }
            rightSection={
              searching && !dictionary && !dictionaryError ? (
                <Loader size={16} />
              ) : undefined
            }
            value={groups}
            data={[
              ...new Set(
                (dictionary?.groups ?? [])
                  .filter(
                    (group) =>
                      !commonGroup || group.commonGroup.name === commonGroup,
                  )
                  .map((group) => group.name),
              ),
            ]}
            onChange={(value) => {
              setGroups(value);
              setOffset(0);
              setSearching(true);
            }}
          />
        </Group>
        {(commonGroup || groups.length > 0) && (
          <Button
            variant="subtle"
            mih={44}
            onClick={() => {
              setCommonGroup(null);
              setGroups([]);
              setOffset(0);
              setSearching(true);
            }}
          >
            {m.resetFilters}
          </Button>
        )}
      </Stack>
      {searching && metadata && (
        <>
          {metadata?.unknownMembershipCount ||
          metadata?.coverage === 'partial' ? (
            <Text size="xs" c="dimmed">
              {m.catalogPartial}
            </Text>
          ) : null}
          {metadata?.stale && (
            <Text size="xs" c="dimmed">
              {m.catalogStale}
            </Text>
          )}
          {metadata?.hasMore && (
            <Button
              variant="subtle"
              mih={44}
              onClick={() => {
                setOffset(offset + 20);
                combobox.openDropdown();
              }}
            >
              {m.catalogMore}
            </Button>
          )}
        </>
      )}
      <Combobox
        store={combobox}
        onOptionSubmit={(option) => {
          if (option === 'manual') onManual?.(query.trim());
          else {
            const item = items.find(
              (candidate) => String(candidate.id) === option,
            );
            if (!item) return;
            if (!item.canPlan || item.name.length > 160) {
              setInspecting(item.id);
              setSearching(false);
              combobox.closeDropdown();
              return;
            }
            setInspecting(null);
            onSelect(item);
            setQuery(item.name);
          }
          setSearching(false);
          setItems([]);
          combobox.closeDropdown();
        }}
      >
        <Combobox.Target>
          <TextInput
            role="combobox"
            label={label}
            required={required}
            placeholder={m.searchHint}
            value={query}
            maxLength={200}
            rightSection={
              state === 'loading' && searching ? (
                <Loader size={16} />
              ) : (
                <Combobox.Chevron />
              )
            }
            onClick={() => {
              setSearching(true);
              combobox.openDropdown();
            }}
            onFocus={() => {
              setSearching(true);
              combobox.openDropdown();
            }}
            onBlur={() => combobox.closeDropdown()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') combobox.closeDropdown();
            }}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setQuery(text);
              setOffset(0);
              setSearching(true);
              setItems([]);
              setState(text.trim() ? 'loading' : 'idle');
              combobox.openDropdown();
              combobox.updateSelectedOptionIndex();
            }}
          />
        </Combobox.Target>
        <Combobox.Dropdown>
          <Combobox.Options style={{ maxHeight: 320, overflowY: 'auto' }}>
            {state === 'error' && searching && (
              <Combobox.Empty>{m.catalogError}</Combobox.Empty>
            )}
            {state === 'ready' && searching && !items.length && (
              <Combobox.Empty>{m.catalogEmpty}</Combobox.Empty>
            )}
            {!query.trim() && !items.length && state === 'idle' && (
              <Combobox.Empty>{m.catalogPrompt}</Combobox.Empty>
            )}
            {searching &&
              items.map((item) => (
                <Combobox.Option
                  key={item.id}
                  aria-label={item.name}
                  aria-description={
                    !item.canPlan || item.name.length > 160
                      ? m.catalogReadOnly
                      : undefined
                  }
                  value={String(item.id)}

                  style={{ minHeight: 44, whiteSpace: 'normal' }}
                >
                  <Group wrap="nowrap" gap="sm">
                    <ExercisePreview ownerId={ownerId} item={item} />
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Text size="sm">{item.name}</Text>
                      {item.snippet && (
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {item.snippet}
                        </Text>
                      )}
                      <Group gap={4}>
                        {item.muscleGroups.map((group) => (
                          <Badge
                            key={group.id}
                            size="xs"
                            color="gray"
                            variant="light"
                          >
                            {group.name}
                          </Badge>
                        ))}
                      </Group>
                      {(!item.canPlan || item.name.length > 160) && (
                        <Text size="xs">{m.catalogReadOnly}</Text>
                      )}
                      {item.canPlan &&
                        item.publicationCapability.state === 'unsupported' && (
                          <Text size="xs" c="dimmed">
                            {m.publicationUnsupported}
                          </Text>
                        )}
                    </Stack>
                  </Group>
                </Combobox.Option>
              ))}
            {onManual &&
              query.trim() &&
              query.trim().length <= 160 &&
              searching && (
                <Combobox.Option value="manual" style={{ minHeight: 44 }}>
                  {m.manualChoice}: {query.trim()}
                </Combobox.Option>
              )}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
      {state === 'error' && searching && (
        <Alert color="red" role="alert">
          {m.catalogError}
        </Alert>
      )}
      {inspecting && (
        <ExerciseDetails
          key={`${ownerId}-${inspecting}`}
          ownerId={ownerId}
          exerciseId={inspecting}
        />
      )}
      {showDetails && exercise.transformMate && !inspecting && (
        <ExerciseDetails
          key={`${ownerId}-${exercise.transformMate.exerciseId}`}
          ownerId={ownerId}
          exerciseId={exercise.transformMate.exerciseId}
        />
      )}
    </Stack>
  );
}
