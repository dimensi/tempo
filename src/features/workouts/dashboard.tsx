'use client';
import { useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  Menu,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconArrowsSort,
  IconCalendarPlus,
  IconDots,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { z } from 'zod';
import { PageHeader } from '@/components/layout/page-header';
import { BottomSheet } from '@/components/shared/bottom-sheet';
import { DateNavigation } from '@/components/shared/date-navigation';
import type { Workout, WorkoutInput } from '@/contracts/workouts';
import { apiFetch } from '@/lib/api-client';
import { readDeviceWrites } from '@/lib/offline-write-client';
import { usePendingWorkoutWrites } from './use-pending-workout-writes';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { useReadOnline } from '@/lib/use-read-online';
import { workoutTitle } from '@/lib/workout-title';
import { DayEditor } from './day-editor';
import { clearWorkoutDraft, dayWorkoutDraftKey } from './draft-storage';
import { DownloadWorkoutButton } from './download-workout-button';
import { copyWorkoutToDate } from './copy-workout';
import { NativeWorkout } from './native-workout';
import { WorkoutSync, useTransformMateSync } from './transformmate-sync';
import { workoutMessages as m } from './messages';
import classes from './day-workout.module.css';
import content from './workout-ui.module.css';

export function WorkoutsDashboard({
  ownerId,
  userId,
  canLog,
  renderComments,
  renderPendingWrites,
}: {
  ownerId: string;
  userId: string;
  canLog: boolean;
  renderComments?: (sessionId: string) => ReactNode;
  renderPendingWrites?: () => ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = z.iso.date().safeParse(params.get('date'));
  const date = selected.success
    ? selected.data
    : new Date().toLocaleDateString('en-CA');
  const resource = useReadResource(
    readResources.workouts(
      `/api/workouts?ownerId=${encodeURIComponent(ownerId)}`,
    ),
  );
  const data = resource.data;
  const online = useReadOnline();
  const sync = useTransformMateSync(ownerId, date);
  const mobile = useMediaQuery('(max-width: 47.99em)');
  const [dayActions, setDayActions] = useState(false);
  const [reorderTarget, setReorderTarget] = useState<string | null>(null);
  const [creating, setCreating] = useState<{
    date: string;
  } | null>(null);
  const [copied, setCopied] = useState<{
    date: string;
    workout: WorkoutInput;
  } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [syncRequested, setSyncRequested] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDate, setCopyDate] = useState(date);
  const [deletion, setDeletion] = useState<{
    entryId: string;
  } | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const entries: {
    id: string;
    label: string;
    workout?: Workout;
    native?: (typeof sync.nativePage.items)[number];
    remote?: (typeof sync.items)[number];
  }[] = (data?.workouts ?? [])
    .filter((item) => item.date === date && !deletedIds.has(item.id))
    .map((workout) => ({
      id: workout.id,
      label: workoutTitle(workout.title, workout.date),
      workout,
      remote: sync.items.find((item) => item.workoutId === workout.id),
    }));
  for (const native of sync.nativePage.items)
    if (
      native.date === date &&
      !sync.items.some(
        (item) =>
          item.remoteTrainingId === native.remoteTrainingId &&
          entries.some((entry) => entry.workout?.id === item.workoutId),
      )
    )
      entries.push({
        id: `native:${native.remoteTrainingId}`,
        label: workoutTitle(native.title, date),
        native,
      });
  for (const remote of sync.items)
    if (
      remote.actual?.date === date &&
      !entries.some(
        (entry) =>
          entry.remote?.id === remote.id ||
          entry.native?.remoteTrainingId === remote.remoteTrainingId,
      )
    )
      entries.push({
        id: `remote:${remote.id}`,
        label: workoutTitle(remote.actual.title, date),
        remote,
      });
  const entry = entries.find((item) => item.id === active) ?? entries[0];
  const linkedIncomplete =
    sync.linkedIncomplete ||
    entries.some(
      (item) =>
        item.remote &&
        item.remote.status !== 'synced' &&
        item.remote.status !== 'started',
    );
  const pendingWrites = usePendingWorkoutWrites(entry?.workout?.id, canLog);
  const downloadExercises = [...(entry?.workout?.exercises ?? [])].flatMap(
    (exercise) =>
      exercise.transformMate
        ? [{ id: exercise.transformMate.exerciseId, name: exercise.name }]
        : [],
  );
  if (entry?.native)
    downloadExercises.push(
      ...entry.native.exercises.map((exercise) => ({
        id: exercise.exerciseId,
        name: exercise.name,
      })),
    );
  if (!downloadExercises.length && entry?.remote?.actual)
    downloadExercises.push(
      ...entry.remote.actual.exercises.map((exercise) => ({
        id: exercise.exerciseId,
        name: exercise.name,
      })),
    );
  const downloadSignature = JSON.stringify([
    entry?.workout,
    entry?.native,
    entry?.remote?.actual,
  ]);
  const create = creating?.date === date;
  const done = async (background = false) => {
    await Promise.all([resource.refresh(), sync.reload()]);
    if (create && !background) setCreating(null);
  };
  async function remove() {
    const workout = entry?.workout;
    if (
      !workout ||
      entry.id !== deletion?.entryId ||
      (!canLog && workout.status !== 'planned')
    )
      return;
    setBusy(true);
    setError(null);
    try {
      if (canLog) {
        const writes = await readDeviceWrites();
        if (
          writes.operations.some(
            (item) =>
              item.operation.recordId === workout.id &&
              item.status !== 'synced',
          )
        )
          throw new Error(m.removalPending);
      }
      const response = await apiFetch(
        `/api/workouts/${workout.id}?ownerId=${encodeURIComponent(ownerId)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId, revision: workout.revision }),
        },
      );
      if (!response.ok)
        throw new Error(response.status === 409 ? m.conflict : m.error);
      clearWorkoutDraft(
        dayWorkoutDraftKey(`${userId}:${ownerId}`, date, workout.id),
      );
      setDeletedIds((previous) => new Set([...previous, workout.id]));
      setCreating(null);
      setCopied(null);
      setActive(null);
      setReorderTarget(null);
      setEditorVersion((version) => version + 1);
      setDraftDirty(false);
      setDeletion(null);
      void resource.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.error);
    } finally {
      setBusy(false);
    }
  }
  const editorKey = create ? `new:${date}` : `${date}:${entry?.id}`;
  const reordering = reorderTarget === editorKey;
  const dayOptions = [
    {
      label: m.createWorkout,
      run: () => {
        setCopied(null);
        setCreating({ date });
      },
    },
    ...(entry?.workout
      ? [
          {
            label: m.copy,
            run: () => {
              setCopyDate(date);
              setCopyOpen(true);
            },
          },
        ]
      : []),
    ...(create ||
    (entry?.workout &&
      entry.workout.status !== 'completed' &&
      (canLog || entry.workout.status === 'planned'))
      ? [
          {
            label: m.reorderExercises,
            icon: <IconArrowsSort size={20} />,
            run: () => setReorderTarget(editorKey),
          },
        ]
      : []),
    {
      label: sync.busy ? m.syncRefreshing : m.refreshShort,
      icon: <IconRefresh size={20} />,
      disabled: sync.busy || !online,
      run: () => {
        setSyncRequested(date);
        void sync.refresh();
      },
    },
    ...(entry?.workout &&
    entry.workout.status !== 'completed' &&
    (canLog || entry.workout.status === 'planned')
      ? [
          {
            label: m.removeWorkout,
            icon: <IconTrash size={20} />,
            color: 'red',
            disabled: draftDirty || busy || !online || pendingWrites,
            run: () => setDeletion({ entryId: entry.id }),
          },
        ]
      : []),
  ];
  return (
    <Stack className={`${classes.workspace} ${content.content}`}>
      <PageHeader
        actions={
          <>
            {mobile ? (
              <>
                <ActionIcon
                  size={44}
                  variant="subtle"
                  aria-label={m.dayMenu}
                  onClick={() => setDayActions(true)}
                >
                  <IconDots size={20} />
                </ActionIcon>
                <BottomSheet
                  opened={dayActions}
                  onClose={() => setDayActions(false)}
                  title={m.dayMenu}
                  closeLabel={m.close}
                >
                  <Stack gap="xs">
                    {dayOptions.map((option) => (
                      <Button
                        key={option.label}
                        variant="default"
                        leftSection={option.icon}
                        color={option.color}
                        c={option.color ? 'red.7' : undefined}
                        justify="start"
                        mih={52}
                        disabled={option.disabled}
                        onClick={() => {
                          setDayActions(false);
                          option.run();
                        }}
                      >
                        {option.label}
                      </Button>
                    ))}
                    {!online && (
                      <Text size="sm" c="dimmed">
                        {m.refreshOfflineHint}
                      </Text>
                    )}
                  </Stack>
                </BottomSheet>
              </>
            ) : (
              <Menu position="bottom-end">
                <Menu.Target>
                  <ActionIcon size={44} variant="subtle" aria-label={m.dayMenu}>
                    <IconDots size={20} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {dayOptions.map((option) => (
                    <Menu.Item
                      key={option.label}
                      leftSection={option.icon}
                      color={option.color}
                      disabled={option.disabled}
                      onClick={option.run}
                    >
                      {option.label}
                    </Menu.Item>
                  ))}
                  {!online && <Menu.Label>{m.refreshOfflineHint}</Menu.Label>}
                </Menu.Dropdown>
              </Menu>
            )}
          </>
        }
      >
        {m.title}
      </PageHeader>
      <div className={classes.dateCard}>
        <DateNavigation
          date={date}
          onSelect={(value) => {
            setCreating(null);
            setCopied(null);
            setActive(null);
            setReorderTarget(null);
            router.push(`/workouts?date=${value}`, { scroll: false });
          }}
          labels={m.dateNavigation}
        />
      </div>
      {syncRequested === date && (
        <Text
          size="sm"
          c={sync.error || linkedIncomplete ? 'orange' : 'dimmed'}
          role="status"
        >
          {sync.busy
            ? m.syncRefreshing
            : sync.configured === false
              ? m.notConfigured
              : sync.error ||
                  sync.nativeRefresh.status === 'error' ||
                  sync.nativeRefresh.status === 'unavailable'
                ? sync.nativeRefresh.errorCode === 'reauth_required'
                  ? m.nativeReconnect
                  : m.syncError
                : linkedIncomplete
                  ? m.syncIncomplete
                  : m.syncUpdated}
        </Text>
      )}
      {renderPendingWrites?.()}
      {(resource.error || sync.denied) && (
        <Alert color="red" role="alert">
          {sync.denied ? m.noAccess : m.loadError}
          <Button variant="subtle" onClick={() => void resource.refresh()}>
            {m.refresh}
          </Button>
        </Alert>
      )}
      {!data && !resource.error && <Loader size="sm" />}
      {entries.length > 1 && !create && (
        <Select
          label={m.chooseWorkout}
          allowDeselect={false}
          value={entry?.id}
          data={entries.map((item) => ({ value: item.id, label: item.label }))}
          onChange={setActive}
        />
      )}
      {data && !create && !entry && (
        <div className={classes.empty}>
          <Stack align="center" gap="md">
            <Title order={2} size="h3">
              {m.emptyDay}
            </Title>
            <Text c="dimmed" ta="center" maw={420}>
              {m.emptyDayHint}
            </Text>
            <div className={classes.emptyActions}>
              <Button
                mih={48}
                leftSection={<IconCalendarPlus size={20} />}
                onClick={() => {
                  setCopied(null);
                  setCreating({ date });
                }}
              >
                {m.createWorkout}
              </Button>
            </div>
            <Button
              variant="subtle"
              mih={44}
              loading={sync.busy}
              disabled={!online}
              onClick={() => {
                setSyncRequested(date);
                void sync.refresh();
              }}
            >
              {m.refreshFromProvider}
            </Button>
            {sync.error && (
              <Text c="red" role="alert">
                {m.syncError}
              </Text>
            )}
          </Stack>
        </div>
      )}
      {data && create && (
        <DayEditor
          key={`new:${ownerId}:${date}:${copied?.date ?? ''}`}
          ownerId={ownerId}
          userId={userId}
          date={date}
          copy={copied?.date === date ? copied.workout : undefined}
          canLog={canLog}
          onSaved={done}
          onDirtyChange={setDraftDirty}
          reordering={reordering}
          onReorderDone={() => setReorderTarget(null)}
          onCancel={() => setCreating(null)}
        />
      )}
      {!create && entry && (
        <div hidden>
          <DownloadWorkoutButton
            key={`${entry.id}:${downloadSignature}`}
            ownerId={ownerId}
            blocked={draftDirty}
            workoutKey={`${ownerId}:${entry.id}`}
            signature={downloadSignature}
            resources={[
              readResources.workouts(
                `/api/workouts?ownerId=${encodeURIComponent(ownerId)}`,
              ),
              ...(entry.native || entry.remote
                ? [
                    readResources.transformMate(
                      `/api/workouts/transformmate?${new URLSearchParams({ ownerId, from: date, to: date, limit: '20' })}`,
                    ),
                  ]
                : []),
            ]}
            exercises={downloadExercises}
          />
        </div>
      )}
      {!create && entry && entry.workout && (
        <DayEditor
          key={`${ownerId}:${date}:${entry.id}:${editorVersion}`}
          ownerId={ownerId}
          userId={userId}
          date={date}
          workout={entry.workout}
          canLog={canLog}
          onSaved={done}
          reordering={reordering}
          onReorderDone={() => setReorderTarget(null)}
          renderComments={renderComments}
          onDirtyChange={setDraftDirty}
        />
      )}
      {!create && entry?.native && !entry.workout && (
        <section aria-label={m.remoteActual}>
          <Text fw={600} mb="sm">
            {m.remoteActual}
          </Text>
          <NativeWorkout item={entry.native} ownerId={ownerId} fullView />
        </section>
      )}
      {!create && entry?.remote && !entry.native && (
        <section aria-label={m.remoteActual}>
          {!entry.workout && (
            <Text fw={600} mb="sm">
              {m.remoteActual}
            </Text>
          )}
          <WorkoutSync item={entry.remote} showActual={!entry.workout} />
        </section>
      )}
      {sync.nativePage.nextCursor && (
        <Button
          variant="subtle"
          disabled={sync.busy || !online}
          onClick={() => void sync.loadMore()}
        >
          {m.loadMore}
        </Button>
      )}
      <Modal
        opened={copyOpen}
        onClose={() => setCopyOpen(false)}
        title={m.copy}
      >
        <Stack>
          <TextInput
            type="date"
            label={m.copyDate}
            value={copyDate}
            onChange={(e) => setCopyDate(e.currentTarget.value)}
          />
          <Button
            disabled={!z.iso.date().safeParse(copyDate).success}
            onClick={() => {
              if (!entry?.workout) return;
              const next = copyWorkoutToDate(entry.workout, copyDate);
              setCopied({ date: copyDate, workout: next });
              setCreating({ date: copyDate });
              setCopyOpen(false);
              router.push(`/workouts?date=${copyDate}`, { scroll: false });
            }}
          >
            {m.copy}
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={deletion !== null}
        onClose={() => {
          if (!busy) setDeletion(null);
        }}
        title={m.confirmDelete}
      >
        <Stack>
          <Text>{m.confirmResultDelete}</Text>
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={busy}
              onClick={() => setDeletion(null)}
            >
              {m.cancel}
            </Button>
            <Button color="red" loading={busy} onClick={() => void remove()}>
              {m.remove}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
