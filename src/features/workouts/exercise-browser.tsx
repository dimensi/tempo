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
  const preview = useExercisePreview(ownerId, info ?? item);
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
          {(info?.muscleGroups ?? item.muscleGroups).map((group) => (
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
  const [offset, setOffset] = useState(0);
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
    offset: String(offset),
    limit: '12',
  });
  if (common) params.set('commonMuscleGroup', common);
  if (muscle) params.set('muscleGroup', muscle);
  const read = useReadResource(
    readResources.catalog(`/api/workouts/transformmate/exercises?${params}`),
  );
  const resetPage = () => {
    setOffset(0);
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
      {read.error && (
        <Alert color="orange">
          {m.catalogError}
          <Button variant="subtle" onClick={() => void read.refresh()}>
            {m.refresh}
          </Button>
        </Alert>
      )}
      {!read.data && !read.error && <Loader size="sm" aria-label={m.loading} />}
      {read.data?.data.length === 0 && <Text c="dimmed">{m.catalogEmpty}</Text>}
      <div className={styles.grid} aria-busy={read.refreshing}>
        {read.data?.data.map((item) => {
          const checked = chosen.some((value) => value.id === item.id);
          return (
            <ExerciseCard
              key={item.id}
              ownerId={ownerId}
              item={item}
              active={playing === item.id}
              onPlay={() => setPlaying(playing === item.id ? null : item.id)}
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
      </div>
      <Group justify="space-between">
        {offset > 0 && (
          <Button
            variant="default"
            mih={44}
            onClick={() => {
              setOffset(Math.max(0, offset - 12));
              setPlaying(null);
            }}
          >
            {m.catalogPrevious}
          </Button>
        )}
        {read.data?.catalog.hasMore && (
          <Button
            variant="default"
            mih={44}
            onClick={() => {
              setOffset(offset + 12);
              setPlaying(null);
            }}
          >
            {m.moreExercises}
          </Button>
        )}
      </Group>
      {footer && <div className={styles.footer}>{footer}</div>}
    </Stack>
  );
}
