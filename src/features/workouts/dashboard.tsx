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
  Tooltip,
} from '@mantine/core';
import { IconDots, IconRefresh } from '@tabler/icons-react';
import { z } from 'zod';
import { PageHeader } from '@/components/layout/page-header';
import { DateNavigation } from '@/components/shared/date-navigation';
import type {
  PlannedWorkout,
  WorkoutPlan,
  WorkoutSession,
} from '@/contracts/workouts';
import { apiFetch } from '@/lib/api-client';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { workoutTitle } from '@/lib/workout-title';
import { DayEditor } from './day-editor';
import { copyPlanToDate } from './copy-plan';
import { NativeWorkout } from './native-workout';
import {
  SyncSummary,
  WorkoutSync,
  useTransformMateSync,
} from './transformmate-sync';
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
  const sync = useTransformMateSync(ownerId, date);
  const [creating, setCreating] = useState<string | null>(null);
  const [copied, setCopied] = useState<{
    date: string;
    workout: PlannedWorkout;
  } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [writesOpen, setWritesOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDate, setCopyDate] = useState(date);
  const [deletion, setDeletion] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const create = creating === date;
  const done = async () => {
    await resource.refresh();
    if (create) setCreating(null);
  };
  async function remove() {
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      const { plan, workout, session } = entry;
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
      setDeletion(false);
      await resource.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack className={`${classes.workspace} ${content.content}`}>
      <PageHeader
        actions={
          <>
            <Tooltip label={m.refreshShort}>
              <ActionIcon
                size={44}
                variant="subtle"
                aria-label={m.refreshShort}
                disabled={sync.busy}
                onClick={() => {
                  setSyncOpen(true);
                  void sync.refresh();
                }}
              >
                <IconRefresh size={20} />
              </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon size={44} variant="subtle" aria-label={m.dayMenu}>
                  <IconDots size={20} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  onClick={() => {
                    setCopied(null);
                    setCreating(date);
                  }}
                >
                  {m.anotherWorkout}
                </Menu.Item>
                {entry?.workout && (
                  <Menu.Item
                    onClick={() => {
                      setCopyDate(date);
                      setCopyOpen(true);
                    }}
                  >
                    {m.copy}
                  </Menu.Item>
                )}
                <Menu.Item onClick={() => setSyncOpen(true)}>
                  {m.syncDetails}
                </Menu.Item>
                {renderPendingWrites && (
                  <Menu.Item onClick={() => setWritesOpen(true)}>
                    {m.deviceWrites}
                  </Menu.Item>
                )}
                {(entry?.plan || entry?.session) && (
                  <Menu.Item color="red" onClick={() => setDeletion(true)}>
                    {m.removeDayWorkout}
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          </>
        }
      >
        {m.title}
      </PageHeader>
      <DateNavigation
        date={date}
        onSelect={(value) => {
          setActive(null);
          router.push(`/workouts?date=${value}`, { scroll: false });
        }}
        labels={m.dateNavigation}
      />
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
              onClick={() => void sync.refresh()}
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
          onCancel={() => setCreating(null)}
        />
      )}
      {!create && entry && (entry.plan || entry.session) && (
        <DayEditor
          key={`${ownerId}:${date}:${entry.id}`}
          ownerId={ownerId}
          userId={userId}
          date={date}
          plan={entry.plan}
          workout={entry.workout}
          existing={entry.session}
          canLog={canLog}
          onSaved={done}
          renderComments={renderComments}
        />
      )}
      {!create && entry?.native && !entry.session && (
        <details open={!entry.plan}>
          <summary>{m.remoteActual}</summary>
          <NativeWorkout item={entry.native} ownerId={ownerId} fullView />
        </details>
      )}
      {!create && entry?.remote?.actual && !entry.native && !entry.session && (
        <details open={!entry.plan}>
          <summary>{m.remoteActual}</summary>
          <WorkoutSync item={entry.remote} />
        </details>
      )}
      {sync.nativePage.nextCursor && (
        <Button
          variant="subtle"
          disabled={sync.busy}
          onClick={() => void sync.loadMore()}
        >
          {m.loadMore}
        </Button>
      )}
      <Modal
        opened={syncOpen}
        onClose={() => setSyncOpen(false)}
        title={m.syncQuiet}
        closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      >
        <SyncSummary sync={sync} />
        {entry?.remote && (
          <WorkoutSync item={entry.remote} showActual={false} />
        )}
      </Modal>
      <Modal
        opened={writesOpen}
        onClose={() => setWritesOpen(false)}
        title={m.deviceWrites}
      >
        {writesOpen && renderPendingWrites?.()}
      </Modal>
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
        opened={deletion}
        onClose={() => {
          if (!busy) setDeletion(false);
        }}
        title={m.confirmDelete}
      >
        <Stack>
          <Text>{m.confirmText}</Text>
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={busy}
              onClick={() => setDeletion(false)}
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
