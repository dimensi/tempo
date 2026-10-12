'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  workoutPlanSchema,
  workoutSessionSchema,
  type WorkoutExercise,
  type WorkoutPlan,
  type WorkoutPlanInput,
  type WorkoutSession,
  type WorkoutSessionInput,
  type WorkoutsData,
  type PlannedWorkout,
} from '@/contracts/workouts';
import { PlanForm, SessionForm, emptyPlan, emptySession, today } from './forms';
import { DateNavigation } from '@/components/shared/date-navigation';
import type { TransformMateSyncItem } from '@/contracts/transformmate';
import { NativeWorkout } from './native-workout';
import { actualSetForExercise } from './transformmate-exercises';
import { copyPlanToDate } from './copy-plan';
import {
  SyncSummary,
  WorkoutSync,
  useTransformMateSync,
} from './transformmate-sync';
import { workoutMessages as m } from './messages';

type Editor =
  | {
      kind: 'plan';
      initial: WorkoutPlanInput;
      existing?: WorkoutPlan;
      workoutId?: string;
    }
  | {
      kind: 'session';
      initial: WorkoutSessionInput;
      existing?: WorkoutSession;
      planId?: string;
      plannedWorkoutId?: string;
    };
type Deletion = { kind: 'plans' | 'sessions'; id: string; revision: number };
const planInput = ({
  title,
  description,
  startsOn,
  endsOn,
  workouts,
}: WorkoutPlan): WorkoutPlanInput => ({
  title,
  description,
  startsOn,
  endsOn,
  workouts,
});
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
function ExerciseTable({
  exercises,
  sync,
  actual,
  factOnly = false,
}: {
  exercises: WorkoutExercise[];
  sync?: TransformMateSyncItem;
  actual?: WorkoutExercise[];
  factOnly?: boolean;
}) {
  return (
    <Stack gap="md">
      {exercises.map((exercise, index) => (
        <Stack gap="xs" key={index}>
          <Text fw={600}>{exercise.name}</Text>
          {exercise.comment && <Text size="sm">{exercise.comment}</Text>}
          <ScrollArea type="auto">
            <Table miw={280} style={{ tableLayout: 'fixed' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={80}>{m.set}</Table.Th>
                  <Table.Th>{factOnly ? m.reps : m.planned}</Table.Th>
                  <Table.Th>{factOnly ? m.weight : m.actual}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {exercise.sets.map((set, i) => {
                  const matched = exercise.transformMate
                    ? actual?.find(
                        (entry) =>
                          entry.transformMate?.occurrenceKey ===
                          exercise.transformMate?.occurrenceKey,
                      )
                    : actual?.[index]?.name === exercise.name
                      ? actual[index]
                      : undefined;
                  const result = matched?.sets[i];
                  const remote = sync?.actual
                    ? actualSetForExercise(sync.actual, exercise, i + 1)
                    : undefined;
                  const value = (entry: typeof set) =>
                    `${entry.reps} × ${entry.weightKg ?? m.noWeight}${entry.weightKg === null ? '' : ' кг'}`;
                  return (
                    <Table.Tr key={i}>
                      <Table.Td>{i + 1}</Table.Td>
                      <Table.Td>
                        {factOnly ? (
                          set.reps
                        ) : (
                          <Text size="sm">{value(set)}</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {factOnly ? (
                          (set.weightKg ?? '—')
                        ) : result ? (
                          <Text size="sm">{value(result)}</Text>
                        ) : remote ? (
                          <Stack gap={2}>
                            <Text size="sm" fw={600}>
                              {remote.done ? m.done : m.notDone}
                            </Text>
                            {remote.metrics.map((metric, metricIndex) => (
                              <Text size="sm" key={metricIndex}>
                                {metric.name}:{' '}
                                {metric.values.length
                                  ? metric.values.join(' / ')
                                  : '—'}{' '}
                                {metric.unit}
                              </Text>
                            ))}
                          </Stack>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Stack>
      ))}
    </Stack>
  );
}
function SessionResult({
  session,
  canLog,
  onEdit,
  onDelete,
  renderComments,
}: {
  session: WorkoutSession;
  canLog: boolean;
  onEdit: () => void;
  onDelete: () => void;
  renderComments?: (sessionId: string) => ReactNode;
}) {
  return (
    <Stack data-testid={`session-${session.id}`}>
      <Group justify="space-between">
        <Title order={3}>{session.title}</Title>
        <Badge>{m[session.status]}</Badge>
      </Group>
      <Text size="sm">
        {session.planSnapshot
          ? `${m.snapshot}: ${session.planSnapshot.planTitle}`
          : m.independent}
      </Text>
      {session.planSnapshot && (
        <ExerciseTable
          exercises={session.planSnapshot.workout.exercises}
          actual={session.exercises}
        />
      )}
      {session.planSnapshot && (
        <Accordion>
          <Accordion.Item value="actual">
            <Accordion.Control>{m.actualDetails}</Accordion.Control>
            <Accordion.Panel>
              <ExerciseTable exercises={session.exercises} factOnly />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
      {!session.planSnapshot && (
        <ExerciseTable exercises={session.exercises} factOnly />
      )}
      {session.note && (
        <Text style={{ whiteSpace: 'pre-wrap' }}>{session.note}</Text>
      )}
      {canLog && (
        <Group>
          <Button mih={44} variant="light" onClick={onEdit}>
            {m.editActual}
          </Button>
          <Button mih={44} variant="subtle" color="red" onClick={onDelete}>
            {m.removeActual}
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
  const createKey = useRef<string | null>(null);
  const [date, setDate] = useState(today);
  const [copy, setCopy] = useState<WorkoutPlan | null>(null);
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
    createKey.current =
      editor.kind === 'plan' && !editor.existing ? crypto.randomUUID() : null;
    setEditorError(null);
    setEditor(editor);
  };
  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true);
    setEditorError(null);
    try {
      const response = await fetch(endpoint(path), {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(path === '/plans' && method === 'POST' && createKey.current
            ? { 'Idempotency-Key': createKey.current }
            : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? m.error);
      }
      setEditor(null);
      setDeletion(null);
      await load();
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : m.error);
    } finally {
      setBusy(false);
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
    open({
      kind: 'plan',
      initial: planInput(plan),
      existing: plan,
      workoutId: workout.id,
    });
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
          onClick={() => {
            const initial = emptyPlan();
            initial.startsOn = initial.endsOn = date;
            initial.workouts[0]!.date = date;
            open({ kind: 'plan', initial, workoutId: initial.workouts[0]!.id });
          }}
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
          <NativeWorkout key={item.remoteTrainingId} item={item} />
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
                <Title order={2}>{workout.title}</Title>
                <Badge>{item ? m.sync : m.localWorkout}</Badge>
              </Group>
              <Text size="sm">{plan.title}</Text>
              {plan.description && (
                <Text style={{ whiteSpace: 'pre-wrap' }}>
                  {plan.description}
                </Text>
              )}
              <ExerciseTable exercises={workout.exercises} sync={item} />
              <WorkoutSync item={item} />
              <Group>
                <Button
                  mih={44}
                  variant="light"
                  onClick={() => editWorkout(plan, workout)}
                >
                  {m.editWorkout}
                </Button>
                {canLog && (
                  <Button
                    mih={44}
                    variant="light"
                    onClick={() => record(plan, workout)}
                  >
                    {m.record}
                  </Button>
                )}
                <Button
                  mih={44}
                  variant="default"
                  onClick={() => {
                    setCopy(plan);
                    setCopyDate(plan.startsOn);
                  }}
                >
                  {m.copy}
                </Button>
              </Group>
              <Accordion>
                <Accordion.Item value="plan">
                  <Accordion.Control>{m.managePlan}</Accordion.Control>
                  <Accordion.Panel>
                    <Stack>
                      <Text>
                        {plan.startsOn} — {plan.endsOn}
                      </Text>
                      <Group>
                        <Button
                          mih={44}
                          variant="default"
                          onClick={() =>
                            open({
                              kind: 'plan',
                              initial: planInput(plan),
                              existing: plan,
                            })
                          }
                        >
                          {m.editPlan}
                        </Button>
                        <Button
                          mih={44}
                          color="red"
                          variant="subtle"
                          onClick={() => {
                            setEditorError(null);
                            setDeletion({
                              kind: 'plans',
                              id: plan.id,
                              revision: plan.revision,
                            });
                          }}
                        >
                          {m.removePlan}
                        </Button>
                      </Group>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              {results.map((session) => (
                <SessionResult
                  key={session.id}
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
              ))}
            </Stack>
          </Paper>
        );
      })}
      {dayRemote.map((item) => (
        <Paper withBorder p="md" key={item.id}>
          <Stack>
            <Title order={2}>{item.actual?.title}</Title>
            <Text>
              {m.publishedSnapshot}:{' '}
              {(item.publishedSnapshot ?? item.planSnapshot).planTitle}
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
        title={editor?.kind === 'plan' ? m.workoutTitle : m.record}
        size="lg"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
        closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      >
        {editor?.kind === 'plan' && (
          <PlanForm
            ownerId={ownerId}
            workoutId={editor.workoutId}
            initial={editor.initial}
            busy={busy}
            error={editorError}
            onCancel={() => setEditor(null)}
            onSave={(value) =>
              void mutate(
                editor.existing ? `/plans/${editor.existing.id}` : '/plans',
                editor.existing ? 'PUT' : 'POST',
                editor.existing
                  ? { revision: editor.existing.revision, data: value }
                  : value,
              )
            }
          />
        )}
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
                open({
                  kind: 'plan',
                  initial: copyPlanToDate(planInput(copy), copyDate),
                });
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
