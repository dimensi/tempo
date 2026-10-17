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
  IconDots,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { z } from 'zod';
import { PageHeader } from '@/components/layout/page-header';
import { BottomSheet } from '@/components/shared/bottom-sheet';
import { DateNavigation } from '@/components/shared/date-navigation';
import type {
  PlannedWorkout,
  WorkoutPlan,
  WorkoutSession,
} from '@/contracts/workouts';
import { apiFetch } from '@/lib/api-client';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { useReadOnline } from '@/lib/use-read-online';
import { workoutTitle } from '@/lib/workout-title';
import { DayEditor } from './day-editor';
import { clearWorkoutDraft, dayWorkoutDraftKey } from './draft-storage';
import { DownloadWorkoutButton } from './download-workout-button';
import { copyPlanToDate } from './copy-plan';
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
  const [creating, setCreating] = useState<string | null>(null);
  const [copied, setCopied] = useState<{
    date: string;
    workout: PlannedWorkout;
  } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [syncRequested, setSyncRequested] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDate, setCopyDate] = useState(date);
  const [deletion, setDeletion] = useState<{
    kind: 'plan' | 'result';
    entryId: string;
  } | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plans =
    data?.plans.flatMap((plan) =>
      plan.workouts
        .filter((workout) => workout.date === date)
        .map((workout) => ({ plan, workout })),
    ) ?? [];
  const sessions =
    data?.sessions.filter((session) => session.date === date) ?? [];
  const entries: {
    id: string;
    label: string;
    plan?: WorkoutPlan;
    workout?: PlannedWorkout;
    session?: WorkoutSession;
    native?: (typeof sync.nativePage.items)[number];
    remote?: (typeof sync.items)[number];
  }[] = [];
  for (const { plan, workout } of plans) {
    const results = sessions.filter(
      (session) =>
        session.planId === plan.id && session.plannedWorkoutId === workout.id,
    );
    const session = results.at(-1);
    const remote = sync.items.find(
      (item) => item.planId === plan.id && item.workoutId === workout.id,
    );
    const native = !session
      ? sync.nativePage.items.find(
          (item) => item.remoteTrainingId === remote?.remoteTrainingId,
        )
      : undefined;
    entries.push({
      id: workout.id,
      label: workoutTitle(workout.title, workout.date),
      plan,
      workout,
      session,
      native,
      remote,
    });
  }
  for (const session of sessions)
    if (!entries.some((entry) => entry.session?.id === session.id))
      entries.push({
        id: session.id,
        label: `${workoutTitle(session.title, session.date)} · ${m[session.status]}`,
        session,
        workout: session.planSnapshot?.workout,
      });
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
  const downloadExercises = [
    ...(entry?.workout?.exercises ?? []),
    ...(entry?.session?.exercises ?? []),
  ].flatMap((exercise) =>
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
    entry?.session,
    entry?.native,
    entry?.remote?.actual,
  ]);
  const create = creating === date;
  const done = async () => {
    await resource.refresh();
    if (create) setCreating(null);
  };
  async function remove() {
    if (
      !entry ||
      entry.id !== deletion?.entryId ||
      (deletion.kind === 'plan' && !entry.plan) ||
      (deletion.kind === 'result' && (!canLog || !entry.session))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const { workout, session } = entry;
      const plan = deletion.kind === 'plan' ? entry.plan : undefined;
      const remaining = plan?.workouts.filter(
        (item) => item.id !== workout?.id,
      );
      const response = await apiFetch(
        `/api/workouts/${plan ? 'plans' : 'sessions'}/${plan?.id ?? session!.id}?ownerId=${encodeURIComponent(ownerId)}`,
        {
          method: plan && remaining?.length ? 'PUT' : 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            plan && remaining?.length
              ? {
                  revision: plan.revision,
                  data: {
                    title: plan.title,
                    description: plan.description,
                    startsOn: plan.startsOn,
                    endsOn: plan.endsOn,
                    workouts: remaining,
                  },
                }
              : { revision: plan?.revision ?? session!.revision },
          ),
        },
      );
      if (!response.ok)
        throw new Error(response.status === 409 ? m.conflict : m.error);
      clearWorkoutDraft(
        dayWorkoutDraftKey(
          `${userId}:${ownerId}`,
          date,
          entry.plan?.id ?? session!.id,
          workout?.id,
        ),
      );
      await resource.refresh();
      setEditorVersion((version) => version + 1);
      setDraftDirty(false);
      setDeletion(null);
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
      label: m.anotherWorkout,
      run: () => {
        setCopied(null);
        setCreating(date);
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
    ...(create || entry?.plan || (canLog && entry?.session)
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
    ...(entry?.plan
      ? [
          {
            label: m.removeDayPlan,
            icon: <IconTrash size={20} />,
            color: 'red',
            disabled: draftDirty || busy,
            run: () => setDeletion({ kind: 'plan', entryId: entry.id }),
          },
        ]
      : []),
    ...(canLog && entry?.session
      ? [
          {
            label: m.removeDayResult,
            icon: <IconTrash size={20} />,
            color: 'red',
            disabled: draftDirty || busy,
            run: () => setDeletion({ kind: 'result', entryId: entry.id }),
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
      <DateNavigation
        date={date}
        onSelect={(value) => {
          setActive(null);
          setReorderTarget(null);
          router.push(`/workouts?date=${value}`, { scroll: false });
        }}
        labels={m.dateNavigation}
      />
      {syncRequested === date && (
        <Text size="sm" c={sync.error ? 'orange' : 'dimmed'} role="status">
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
            <Text c="dimmed">{m.prepareHint}</Text>
            <Button
              mih={44}
              onClick={() => {
                setCopied(null);
                setCreating(date);
              }}
            >
              {m.newWorkout}
            </Button>
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
          key={`new:${ownerId}:${date}:${copied?.workout.id ?? ''}`}
          ownerId={ownerId}
          userId={userId}
          date={date}
          workout={copied?.date === date ? copied.workout : undefined}
          canLog={canLog}
          onSaved={done}
          reordering={reordering}
          onReorderDone={() => setReorderTarget(null)}
          onCancel={() => setCreating(null)}
        />
      )}
      {!create && entry && (
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
      )}
      {!create && entry && (entry.plan || entry.session) && (
        <DayEditor
          key={`${ownerId}:${date}:${entry.id}:${editorVersion}`}
          ownerId={ownerId}
          userId={userId}
          date={date}
          plan={entry.plan}
          workout={entry.workout}
          existing={entry.session}
          canLog={canLog}
          onSaved={done}
          reordering={reordering}
          onReorderDone={() => setReorderTarget(null)}
          renderComments={renderComments}
          onDirtyChange={setDraftDirty}
        />
      )}
      {!create && entry?.native && !entry.session && (
        <section aria-label={m.remoteActual}>
          <Text fw={600} mb="sm">
            {m.remoteActual}
          </Text>
          <NativeWorkout item={entry.native} ownerId={ownerId} fullView />
        </section>
      )}
      {!create && entry?.remote?.actual && !entry.native && !entry.session && (
        <section aria-label={m.remoteActual}>
          <Text fw={600} mb="sm">
            {m.remoteActual}
          </Text>
          <WorkoutSync item={entry.remote} />
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
              const next = copyPlanToDate(
                {
                  title: '',
                  description: '',
                  startsOn: entry.workout.date,
                  endsOn: entry.workout.date,
                  workouts: [entry.workout],
                },
                copyDate,
              );
              setCopied({ date: copyDate, workout: next.workouts[0]! });
              setCreating(copyDate);
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
          <Text>
            {deletion?.kind === 'result'
              ? m.confirmResultDelete
              : m.confirmText}
          </Text>
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
