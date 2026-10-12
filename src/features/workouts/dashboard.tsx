'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  workoutPlanSchema,
  workoutSessionSchema,
  type WorkoutPlan,
  type WorkoutSession,
  type WorkoutSessionInput,
  type WorkoutsData,
  type PlannedWorkout,
} from '@/contracts/workouts';
import { SessionForm, emptySession, today } from './forms';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { workoutTitle } from '@/lib/workout-title';
import { DateNavigation } from '@/components/shared/date-navigation';
import { NativeWorkout } from './native-workout';
import { ExerciseTable } from './exercise-table';
import {
  IconArrowRight,
  IconPencil,
  IconCopy,
  IconTrash,
  IconClipboardCheck,
  IconCalendar,
} from '@tabler/icons-react';
import Link from 'next/link';
import {
  SyncSummary,
  WorkoutSync,
  useTransformMateSync,
} from './transformmate-sync';
import { workoutMessages as m } from './messages';

type Editor = {
  kind: 'session';
  initial: WorkoutSessionInput;
  existing?: WorkoutSession;
  planId?: string;
  plannedWorkoutId?: string;
};
type Deletion = { kind: 'plans' | 'sessions'; id: string; revision: number };
const sessionInput = ({
  title,
  date,
  exercises,
  note,
  status,
}: WorkoutSession): WorkoutSessionInput => ({
  title,
  date,
  exercises,
  note,
  status,
});
function SessionResult({
  session,
  canLog,
  onEdit,
  onDelete,
  renderComments,
  comparisonShown = false,
}: {
  session: WorkoutSession;
  canLog: boolean;
  onEdit: () => void;
  onDelete: () => void;
  renderComments?: (sessionId: string) => ReactNode;
  comparisonShown?: boolean;
}) {
  return (
    <Stack data-testid={`session-${session.id}`}>
      <Group justify="space-between">
        <Title order={3}>{workoutTitle(session.title, session.date)}</Title>
        <Badge>{m[session.status]}</Badge>
      </Group>
      <Text size="sm">
        {session.planSnapshot
          ? `${m.snapshot}: ${workoutTitle(session.planSnapshot.planTitle, session.planSnapshot.workout.date)}`
          : m.independent}
      </Text>
      {session.planSnapshot && !comparisonShown && (
        <ExerciseTable
          exercises={session.planSnapshot.workout.exercises}
          actual={session.exercises}
        />
      )}
      {session.planSnapshot && (
        <Stack gap="xs">
          <Text fw={600}>{m.actualDetails}</Text>
          <ExerciseTable exercises={session.exercises} factOnly />
        </Stack>
      )}
      {!session.planSnapshot && (
        <ExerciseTable exercises={session.exercises} factOnly />
      )}
      {session.note && (
        <Text style={{ whiteSpace: 'pre-wrap' }}>{session.note}</Text>
      )}
      <Button
        component={Link}
        href={`/workouts/sessions/${session.id}?date=${session.date}`}
        variant="subtle"
        size="compact-sm"
        mih={44}
        leftSection={<IconArrowRight size={16} />}
      >
        {m.view}
      </Button>
      {canLog && (
        <Group gap="xs">
          <Button
            mih={44}
            size="compact-sm"
            variant="subtle"
            leftSection={<IconPencil size={16} />}
            aria-label={m.editActual}
            onClick={onEdit}
          >
            {m.editShort}
          </Button>
          <Button
            mih={44}
            size="compact-sm"
            variant="subtle"
            color="red"
            leftSection={<IconTrash size={16} />}
            aria-label={m.removeActual}
            onClick={onDelete}
          >
            {m.deleteShort}
          </Button>
        </Group>
      )}
      {renderComments?.(session.id)}
    </Stack>
  );
}
function ScopedWorkoutsDashboard({
  ownerId,
  canLog,
  renderComments,
}: {
  ownerId: string;
  canLog: boolean;
  renderComments?: (sessionId: string) => ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedDate = z.iso.date().safeParse(searchParams.get('date'));
  const date = selectedDate.success ? selectedDate.data : today();
  const setDate = (value: string) =>
    router.replace(`/workouts?date=${value}`, { scroll: false });
  const [copy, setCopy] = useState<{
    plan: WorkoutPlan;
    workout: PlannedWorkout;
  } | null>(null);
  const [copyDate, setCopyDate] = useState('');
  const [data, setData] = useState<WorkoutsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const sync = useTransformMateSync(ownerId, data, date);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const endpoint = useCallback(
    (path = '') =>
      `/api/workouts${path}?ownerId=${encodeURIComponent(ownerId)}`,
    [ownerId],
  );
  const read = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(endpoint(), { cache: 'no-store', signal });
      if (!response.ok) {
        throw new Error(m.loadError);
      }
      const { data: incoming } = await response.json();
      return {
        contractVersion: 1,
        source: 'user',
        plans: incoming.plans.map((plan: unknown) =>
          workoutPlanSchema.parse(plan),
        ),
        sessions: incoming.sessions.map((session: unknown) =>
          workoutSessionSchema.parse(session),
        ),
      } satisfies WorkoutsData;
    },
    [endpoint],
  );
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : m.loadError);
      });
    return () => controller.abort();
  }, [read]);
  async function load() {
    try {
      setData(await read());
      setError(null);
    } catch (error) {
      setData(null);
      setError(error instanceof Error ? error.message : m.loadError);
    }
  }
  const open = (editor: Editor) => {
    setEditorError(null);
    setEditor(editor);
  };
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true);
    setEditorError(null);
    try {
      const response = await fetch(endpoint(path), {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? m.error);
      }
      if (!mounted.current) return;
      setEditor(null);
      setDeletion(null);
      if (method !== 'DELETE') {
        const result = await response.json();
        const saved = workoutSessionSchema.parse(result.data);
        router.push(`/workouts/sessions/${saved.id}?date=${saved.date}`);
      } else await load();
    } catch (error) {
      if (mounted.current)
        setEditorError(error instanceof Error ? error.message : m.error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const record = (plan: WorkoutPlan, workout: PlannedWorkout) =>
    open({
      kind: 'session',
      initial: {
        title: workout.title,
        date: workout.date,
        exercises: structuredClone(workout.exercises),
        status: 'completed',
        note: '',
      },
      planId: plan.id,
      plannedWorkoutId: workout.id,
    });
  const dayPlans =
    data?.plans.flatMap((plan) =>
      plan.workouts
        .filter((workout) => workout.date === date)
        .map((workout) => ({ plan, workout })),
    ) ?? [];
  const daySessions =
    data?.sessions.filter((session) => session.date === date) ?? [];
  const dayRemote = sync.items.filter(
    (item) =>
      item.actual?.date === date &&
      !sync.nativePage.items.some(
        (native) => native.remoteTrainingId === item.remoteTrainingId,
      ) &&
      !dayPlans.some(
        ({ plan, workout }) =>
          item.planId === plan.id && item.workoutId === workout.id,
      ),
  );
  const editWorkout = (plan: WorkoutPlan, workout: PlannedWorkout) =>
    router.push(
      `/workouts/plans/${plan.id}/edit?workout=${workout.id}&date=${date}`,
    );
  if (sync.denied)
    return (
      <Alert color="red" role="alert">
        {m.noAccess}
      </Alert>
    );
  return (
    <Stack style={{ minWidth: 0 }}>
      <Title order={1}>{m.title}</Title>
      <Text c="var(--mantine-color-text)">{m.description}</Text>
      {!canLog && <Alert>{m.trainerHint}</Alert>}
      {error && (
        <Alert color="red" role="alert">
          {error}
          <Button variant="subtle" mih={44} onClick={() => void load()}>
            {m.refresh}
          </Button>
        </Alert>
      )}
      {!data && !error && (
        <Group>
          <Loader size="sm" />
          <Text>{m.loading}</Text>
        </Group>
      )}
      <DateNavigation
        date={date}
        onSelect={setDate}
        labels={m.dateNavigation}
      />
      <Group justify="space-between">
        <Button
          mih={44}
          onClick={() => router.push(`/workouts/new?date=${date}`)}
        >
          {m.newWorkout}
        </Button>
        {canLog && (
          <Button
            mih={44}
            variant="subtle"
            onClick={() =>
              open({ kind: 'session', initial: { ...emptySession(), date } })
            }
          >
            {m.recordIndependent}
          </Button>
        )}
      </Group>
      <SyncSummary sync={sync} />
      {data &&
        !dayPlans.length &&
        !daySessions.length &&
        !dayRemote.length &&
        !sync.nativePage.items.length &&
        !sync.busy &&
        !sync.error && (
          <Paper withBorder p="lg">
            <Stack gap="xs">
              <Title order={2}>{m.emptyDay}</Title>
              <Text>{m.emptyDayHint}</Text>
            </Stack>
          </Paper>
        )}
      {sync.nativePage.items
        .filter(
          (item) =>
            item.date === date &&
            !dayPlans.some(({ plan, workout }) =>
              sync.items.some(
                (entry) =>
                  entry.planId === plan.id &&
                  entry.workoutId === workout.id &&
                  entry.remoteTrainingId === item.remoteTrainingId,
              ),
            ),
        )
        .map((item) => (
          <Stack key={item.remoteTrainingId}>
            <NativeWorkout item={item} />
            <Button
              component={Link}
              href={`/workouts/native/${item.remoteTrainingId}?date=${date}`}
              variant="subtle"
              size="compact-sm"
              mih={44}
              leftSection={<IconArrowRight size={16} />}
            >
              {m.view}
            </Button>
          </Stack>
        ))}
      {sync.nativePage.nextCursor && (
        <Button
          mih={44}
          variant="default"
          loading={sync.busy}
          onClick={() => void sync.loadMore()}
        >
          {m.loadMore}
        </Button>
      )}
      {dayPlans.map(({ plan, workout }) => {
        const item = sync.items.find(
          (item) => item.planId === plan.id && item.workoutId === workout.id,
        );
        const results = daySessions.filter(
          (session) =>
            session.planId === plan.id &&
            session.plannedWorkoutId === workout.id,
        );
        const latestResult = results.at(-1);
        return (
          <Paper
            withBorder
            p="md"
            key={workout.id}
            data-testid={`plan-${plan.id}`}
            style={{ overflowWrap: 'anywhere' }}
          >
            <Stack>
              <Group justify="space-between">
                <Title order={2}>
                  {workoutTitle(workout.title, workout.date)}
                </Title>
                <Badge color="gray" variant="outline">
                  {m.localSource}
                </Badge>
              </Group>
              {plan.title && <Text size="sm">{plan.title}</Text>}
              {plan.description && (
                <Text style={{ whiteSpace: 'pre-wrap' }}>
                  {plan.description}
                </Text>
              )}
              <ExerciseTable
                exercises={workout.exercises}
                sync={item}
                actual={latestResult?.exercises}
              />
              <WorkoutSync item={item} showActual={false} />
              <Group gap="xs">
                <Button
                  component={Link}
                  href={`/workouts/plans/${plan.id}/workouts/${workout.id}?date=${date}`}
                  size="compact-sm"
                  mih={44}
                  leftSection={<IconArrowRight size={16} />}
                >
                  {m.view}
                </Button>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  mih={44}
                  leftSection={<IconPencil size={16} />}
                  aria-label={m.editWorkout}
                  onClick={() => editWorkout(plan, workout)}
                >
                  {m.editShort}
                </Button>
                {canLog && (
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    mih={44}
                    leftSection={<IconClipboardCheck size={16} />}
                    aria-label={m.record}
                    onClick={() => record(plan, workout)}
                  >
                    {m.recordShort}
                  </Button>
                )}
                <Button
                  variant="subtle"
                  size="compact-sm"
                  mih={44}
                  leftSection={<IconCopy size={16} />}
                  aria-label={m.copy}
                  onClick={() => {
                    setCopy({ plan, workout });
                    setCopyDate(workout.date);
                  }}
                >
                  {m.copyShort}
                </Button>
                {plan.workouts.length > 1 && (
                  <Button
                    component={Link}
                    href={`/workouts/plans/${plan.id}/edit?date=${date}`}
                    variant="subtle"
                    size="compact-sm"
                    mih={44}
                    leftSection={<IconCalendar size={16} />}
                    aria-label={m.editPlan}
                  >
                    {m.planShort}
                  </Button>
                )}
                <Button
                  variant="subtle"
                  color="red"
                  size="compact-sm"
                  mih={44}
                  leftSection={<IconTrash size={16} />}
                  aria-label={m.removePlan}
                  onClick={() => {
                    setEditorError(null);
                    setDeletion({
                      kind: 'plans',
                      id: plan.id,
                      revision: plan.revision,
                    });
                  }}
                >
                  {m.deleteShort}
                </Button>
              </Group>
              {results.map((session) => (
                <SessionResult
                  key={session.id}
                  session={session}
                  comparisonShown={session.id === latestResult?.id}
                  canLog={canLog}
                  renderComments={renderComments}
                  onEdit={() =>
                    open({
                      kind: 'session',
                      initial: sessionInput(session),
                      existing: session,
                    })
                  }
                  onDelete={() => {
                    setEditorError(null);
                    setDeletion({
                      kind: 'sessions',
                      id: session.id,
                      revision: session.revision,
                    });
                  }}
                />
              ))}
            </Stack>
          </Paper>
        );
      })}
      {dayRemote.map((item) => (
        <Paper withBorder p="md" key={item.id}>
          <Stack>
            <Group justify="space-between">
              <Title order={2}>{item.actual?.title}</Title>
              <Button
                component={Link}
                href={`/workouts/links/${item.id}?date=${date}`}
                variant="subtle"
                size="compact-sm"
                mih={44}
                leftSection={<IconArrowRight size={16} />}
              >
                {m.view}
              </Button>
            </Group>
            <Text>
              {m.publishedSnapshot}:{' '}
              {workoutTitle(
                (item.publishedSnapshot ?? item.planSnapshot).planTitle,
                (item.publishedSnapshot ?? item.planSnapshot).workout.date,
              )}
            </Text>
            <ExerciseTable
              exercises={
                (item.publishedSnapshot ?? item.planSnapshot).workout.exercises
              }
              sync={item}
            />
            <WorkoutSync item={item} />
          </Stack>
        </Paper>
      ))}
      {daySessions
        .filter(
          (session) =>
            !dayPlans.some(
              ({ plan, workout }) =>
                session.planId === plan.id &&
                session.plannedWorkoutId === workout.id,
            ),
        )
        .map((session) => (
          <Paper withBorder p="md" key={session.id}>
            <SessionResult
              session={session}
              canLog={canLog}
              renderComments={renderComments}
              onEdit={() =>
                open({
                  kind: 'session',
                  initial: sessionInput(session),
                  existing: session,
                })
              }
              onDelete={() => {
                setEditorError(null);
                setDeletion({
                  kind: 'sessions',
                  id: session.id,
                  revision: session.revision,
                });
              }}
            />
          </Paper>
        ))}
      <Modal
        opened={editor !== null}
        onClose={() => {
          if (!busy) setEditor(null);
        }}
        title={m.record}
        size="lg"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
        closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      >
        {editor?.kind === 'session' && (
          <SessionForm
            ownerId={ownerId}
            initial={editor.initial}
            busy={busy}
            error={editorError}
            onCancel={() => setEditor(null)}
            onSave={(value) =>
              void mutate(
                editor.existing
                  ? `/sessions/${editor.existing.id}`
                  : '/sessions',
                editor.existing ? 'PUT' : 'POST',
                editor.existing
                  ? { revision: editor.existing.revision, data: value }
                  : {
                      ...value,
                      ...(editor.planId
                        ? {
                            planId: editor.planId,
                            plannedWorkoutId: editor.plannedWorkoutId,
                          }
                        : {}),
                    },
              )
            }
          />
        )}
      </Modal>
      <Modal
        opened={copy !== null}
        onClose={() => setCopy(null)}
        title={m.copy}
        closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      >
        <Stack>
          <TextInput
            type="date"
            label={m.copyDate}
            value={copyDate}
            onChange={(event) => setCopyDate(event.currentTarget.value)}
          />
          <Button
            mih={44}
            disabled={
              !/^\d{4}-\d{2}-\d{2}$/.test(copyDate) ||
              !Number.isFinite(Date.parse(copyDate))
            }
            onClick={() => {
              if (copy) {
                router.push(
                  `/workouts/new?copy=${copy.plan.id}&workout=${copy.workout.id}&date=${copyDate}&returnDate=${date}`,
                );
                setCopy(null);
              }
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
        closeOnEscape={!busy}
        closeOnClickOutside={!busy}
        withCloseButton={!busy}
        closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      >
        <Stack>
          <Text>{m.confirmText}</Text>
          {editorError && <Alert color="red">{editorError}</Alert>}
          <Group grow>
            <Button
              mih={44}
              variant="default"
              disabled={busy}
              onClick={() => setDeletion(null)}
            >
              {m.cancel}
            </Button>
            <Button
              mih={44}
              color="red"
              loading={busy}
              onClick={() => {
                if (deletion)
                  void mutate(`/${deletion.kind}/${deletion.id}`, 'DELETE', {
                    revision: deletion.revision,
                  });
              }}
            >
              {m.confirmDelete}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export function WorkoutsDashboard(props: {
  ownerId: string;
  canLog: boolean;
  renderComments?: (sessionId: string) => ReactNode;
}) {
  return <ScopedWorkoutsDashboard key={props.ownerId} {...props} />;
}
