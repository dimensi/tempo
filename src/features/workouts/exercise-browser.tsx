'use client';
import { useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from '@mantine/hooks';
import {
  Alert,
  Badge,
  Button,
  Group,
  Image,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import {
  IconCheck,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
} from '@tabler/icons-react';
import type { TransformMateCatalogItem } from '@/contracts/transformmate';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { useExercisePreview } from './exercise-preview';
import { ExerciseDetails } from './exercise-details';
import { exerciseHref, techniqueHref } from './transformmate-exercises';
import { workoutMessages as m } from './messages';
import styles from './exercise-browser.module.css';

function ExerciseCard({
  ownerId,
  item,
  active,
  onPlay,
  checked,
  disabled,
  onChoose,
}: {
  ownerId: string;
  item: TransformMateCatalogItem;
  active: boolean;
  onPlay: () => void;
  checked: boolean;
  disabled: boolean;
  onChoose?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const detail = useReadResource(
    readResources.exercise(
      visible ? exerciseHref(ownerId, item.id) : undefined,
    ),
  );
  const info = detail.data;
  const enrichedItem =
    item.detailCoverage === 'available' ? item : (info ?? item);
  const preview = useExercisePreview(ownerId, enrichedItem);
  return (
    <Paper
      ref={host}
      component="article"
      withBorder
      radius="md"
      className={styles.card}
      data-selected={checked || undefined}
    >
      {active ? (
        <div className={styles.media}>
          <ExerciseDetails ownerId={ownerId} exerciseId={item.id} autoPlay />
        </div>
      ) : (
        <UnstyledButton
          className={styles.preview}
          onClick={onPlay}
          aria-label={`${m.playTechnique}: ${item.name}`}
        >
          {preview?.src && (
            <Image src={preview.src} alt="" className={styles.poster} />
          )}
          {!preview?.src && info?.hasVideo && (
            <video
              aria-hidden="true"
              muted
              playsInline
              preload="metadata"
              src={`${techniqueHref(ownerId, item.id)}#t=0.1`}
              className={styles.poster}
            />
          )}
          <span className={styles.play}>
            <IconPlayerPlay size={24} />
            <span>{m.playTechnique}</span>
          </span>
        </UnstyledButton>
      )}
      <Stack gap="sm" p="md">
        <Text component="h2" size="md" fw={650} className={styles.name}>
          {item.name}
        </Text>
        <Group gap={6}>
          {enrichedItem.muscleGroups.map((group) => (
            <Badge key={group.id} size="sm" variant="light" color="gray">
              {group.name}
            </Badge>
          ))}
        </Group>
        {onChoose && (
          <Button
            variant={checked ? 'filled' : 'light'}
            className={checked ? styles.solid : undefined}
            mih={44}
            fullWidth
            disabled={disabled}
            leftSection={
              checked ? <IconCheck size={18} /> : <IconPlus size={18} />
            }
            aria-pressed={checked}
            aria-label={`${checked ? m.unchooseCard : m.chooseCard}: ${item.name}`}
            onClick={onChoose}
          >
            {checked ? m.selected : disabled ? m.catalogReadOnly : m.chooseCard}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

function ExerciseResults({
  ownerId,
  query,
  chosen,
  capacity,
  playing,
  onPlay,
  onChoose,
  offset = 0,
  previousIds = [],
}: {
  ownerId: string;
  query: string;
  chosen: TransformMateCatalogItem[];
  capacity: number;
  playing: number | null;
  onPlay: (id: number) => void;
  onChoose?: (item: TransformMateCatalogItem) => void;
  offset?: number;
  previousIds?: number[];
}) {
  const [expanded, setExpanded] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const read = useReadResource(
    readResources.catalog(
      `/api/workouts/transformmate/exercises?${query}&offset=${offset}`,
    ),
  );
  const refreshCatalog = read.refresh;
  const refreshState = read.data?.catalog.refreshState;
  useEffect(() => {
    if (expanded || refreshState !== 'updating') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (document.visibilityState !== 'hidden') await refreshCatalog();
      if (active) timer = setTimeout(() => void refresh(), 10000);
    };
    timer = setTimeout(() => void refresh(), 10000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [expanded, refreshState, refreshCatalog]);
  const canLoad =
    !expanded &&
    Boolean(read.data?.catalog.hasMore) &&
    !read.refreshing &&
    !read.error;
  useEffect(() => {
    if (!canLoad || !end.current) return;
    // The picker scrolls inside its dialog; the standalone catalogue uses the page.
    let root = end.current.parentElement;
    while (
      root &&
      root !== document.body &&
      !/(auto|scroll)/.test(getComputedStyle(root).overflowY)
    )
      root = root.parentElement;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          observer.disconnect();
          setExpanded(true);
        }
      },
      { root: root === document.body ? null : root, rootMargin: '240px 0px' },
    );
    observer.observe(end.current);
    return () => observer.disconnect();
  }, [canLoad]);
  const seen = new Set(previousIds);
  const items = (read.data?.data ?? []).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return (
    <>
      {items.map((item) => {
        const checked = chosen.some((value) => value.id === item.id);
        return (
          <ExerciseCard
            key={item.id}
            ownerId={ownerId}
            item={item}
            active={playing === item.id}
            onPlay={() => onPlay(item.id)}
            checked={checked}
            disabled={
              !checked &&
              (!item.canPlan ||
                item.name.length > 160 ||
                chosen.length >= capacity)
            }
            onChoose={onChoose ? () => onChoose(item) : undefined}
          />
        );
      })}
      {expanded ? (
        <ExerciseResults
          ownerId={ownerId}
          query={query}
          chosen={chosen}
          capacity={capacity}
          playing={playing}
          onPlay={onPlay}
          onChoose={onChoose}
          offset={offset + 12}
          previousIds={[...seen]}
        />
      ) : (
        <div ref={end} className={styles.catalogTail}>
          {read.error ? (
            <Alert color="orange">
              {m.catalogPageError}
              <Button
                variant="subtle"
                mih={44}
                onClick={() => void read.refresh()}
              >
                {m.refresh}
              </Button>
            </Alert>
          ) : !read.data || read.refreshing ? (
            <Group gap="sm" role="status">
              <Loader size="sm" aria-hidden />
              <Text size="sm" c="dimmed">
                {m.catalogLoading}
              </Text>
            </Group>
          ) : offset === 0 && items.length === 0 ? (
            <Text c="dimmed">{m.catalogEmpty}</Text>
          ) : (
            <Text size="sm" c="dimmed" role="status">
              {m.catalogLoaded} {seen.size}
              {read.data.catalog.total !== null &&
                ` ${m.catalogOf} ${read.data.catalog.total}`}
            </Text>
          )}
        </div>
      )}
    </>
  );
}

export function ExerciseBrowser({
  ownerId,
  chosen = [],
  capacity = 50,
  onChoose,
  onManual,
  footer,
}: {
  ownerId: string;
  chosen?: TransformMateCatalogItem[];
  capacity?: number;
  onChoose?: (item: TransformMateCatalogItem) => void;
  onManual?: (name: string) => void;
  footer?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 250);
  const [common, setCommon] = useState('');
  const [muscle, setMuscle] = useState('');
  const [playing, setPlaying] = useState<number | null>(null);
  const dictionary = useReadResource(
    readResources.muscleDictionary(
      `/api/workouts/transformmate/muscle-groups?ownerId=${encodeURIComponent(ownerId)}`,
    ),
  );
  const groups = dictionary.data?.groups ?? [];
  const commonGroups = [
    ...new Set(groups.map((group) => group.commonGroup.name)),
  ];
  const params = new URLSearchParams({
    ownerId,
    q: debounced,
    limit: '12',
  });
  if (common) params.set('commonMuscleGroup', common);
  if (muscle) params.set('muscleGroup', muscle);
  const resetPage = () => {
    setPlaying(null);
  };
  return (
    <Stack gap="md" className={styles.browser}>
      <div className={styles.filters}>
        <TextInput
          label={m.searchExercises}
          leftSection={<IconSearch size={18} />}
          placeholder={m.searchHint}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            resetPage();
          }}
        />
        <div
          className={styles.categories}
          role="group"
          aria-label={m.muscleCommon}
        >
          {['', ...commonGroups].map((name) => (
            <Button
              key={name}
              variant={common === name ? 'filled' : 'default'}
              className={common === name ? styles.solid : undefined}
              radius="xl"
              mih={44}
              aria-pressed={common === name}
              onClick={() => {
                setCommon(name);
                setMuscle('');
                resetPage();
              }}
            >
              {name || m.allMuscles}
            </Button>
          ))}
        </div>
        <Group align="end" gap="sm">
          <Select
            label={m.muscleGroups}
            placeholder={m.allMuscles}
            searchable
            clearable
            value={muscle || null}
            data={[
              ...new Set(
                groups
                  .filter(
                    (group) => !common || group.commonGroup.name === common,
                  )
                  .map((group) => group.name),
              ),
            ]}
            onChange={(value) => {
              setMuscle(value ?? '');
              resetPage();
            }}
            style={{ flex: 1, minWidth: 180 }}
          />
          {(common || muscle) && (
            <Button
              variant="subtle"
              mih={44}
              onClick={() => {
                setCommon('');
                setMuscle('');
                resetPage();
              }}
            >
              {m.resetFilters}
            </Button>
          )}
        </Group>
        {dictionary.error && (
          <Button variant="subtle" onClick={() => void dictionary.refresh()}>
            {m.filtersLoading} · {m.refresh}
          </Button>
        )}
      </div>
      {onManual && query.trim() && query.trim().length <= 160 && (
        <Button
          variant="default"
          mih={44}
          leftSection={<IconPlus size={18} />}
          disabled={capacity < 1}
          onClick={() => onManual(query.trim())}
        >
          {m.manualChoice}: {query.trim()}
        </Button>
      )}
      <div className={styles.grid}>
        <ExerciseResults
          key={params.toString()}
          ownerId={ownerId}
          query={params.toString()}
          chosen={chosen}
          capacity={capacity}
          playing={playing}
          onPlay={(id) => setPlaying(playing === id ? null : id)}
          onChoose={onChoose}
        />
      </div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </Stack>
  );
}
