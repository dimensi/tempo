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
  ScrollArea,
  Stack,
  Table,
  Tabs,
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
import { PlanForm, SessionForm, emptyPlan, emptySession } from './forms';
import type { TransformMateSyncItem } from '@/contracts/transformmate';
import { actualSetForExercise } from './transformmate-exercises';
import { copyPlanToDate } from './copy-plan';
import {
  SyncSummary,
  WorkoutSync,
  useTransformMateSync,
} from './transformmate-sync';
import { workoutMessages as m } from './messages';

type Editor =
  | { kind: 'plan'; initial: WorkoutPlanInput; existing?: WorkoutPlan }
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
}: {
  exercises: WorkoutExercise[];
  sync?: TransformMateSyncItem;
}) {
  return (
    <ScrollArea type="auto">
      <Table miw={280}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{m.exercise}</Table.Th>
            <Table.Th>{m.set}</Table.Th>
            <Table.Th>{m.reps}</Table.Th>
            <Table.Th>{m.weight}</Table.Th>
            {sync?.actual && <Table.Th>{m.remoteActual}</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {exercises.flatMap((exercise, index) =>
            exercise.sets.map((set, i) => (
              <Table.Tr key={`${index}-${i}`}>
                <Table.Td style={{ overflowWrap: 'anywhere' }}>
                  {exercise.name}
                  {exercise.comment && (
                    <Text size="xs">{exercise.comment}</Text>
                  )}
                </Table.Td>
                <Table.Td>{i + 1}</Table.Td>
                <Table.Td>{set.reps}</Table.Td>
                <Table.Td>{set.weightKg ?? '—'}</Table.Td>
                {sync?.actual && (
                  <Table.Td style={{ overflowWrap: 'anywhere' }}>
                    {(() => {
                      const actual = actualSetForExercise(
                        sync.actual,
                        exercise,
                        i + 1,
                      );
                      return actual
                        ? `${actual.done ? m.done : m.notDone} · ${actual.metrics.map((metric) => `${metric.name}: ${metric.values.length ? metric.values.join(' / ') : '—'} ${metric.unit}`).join('; ')}`
                        : '—';
                    })()}
                  </Table.Td>
                )}
              </Table.Tr>
            )),
          )}
        </Table.Tbody>
      </Table>
    </ScrollArea>
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
  const [copy, setCopy] = useState<WorkoutPlan | null>(null);
  const [copyDate, setCopyDate] = useState('');
  const [data, setData] = useState<WorkoutsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const sync = useTransformMateSync(ownerId, data);
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
      <Group>
        <Button
          mih={44}
          onClick={() => open({ kind: 'plan', initial: emptyPlan() })}
        >
          {m.newPlan}
        </Button>
        {canLog && (
          <Button
            mih={44}
            variant="light"
            onClick={() => open({ kind: 'session', initial: emptySession() })}
          >
            {m.newSession}
          </Button>
        )}
      </Group>
      <SyncSummary sync={sync} />
      <Tabs defaultValue="plans">
        <Tabs.List>
          <Tabs.Tab value="plans" mih={44}>
            {m.plans}
          </Tabs.Tab>
          <Tabs.Tab value="history" mih={44}>
            {m.history}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="plans" pt="md">
          <Stack>
            {data?.plans.length === 0 && <Text>{m.emptyPlans}</Text>}
            {data?.plans.map((plan) => (
              <Paper
                withBorder
                p="md"
                key={plan.id}
                data-testid={`plan-${plan.id}`}
                style={{ overflowWrap: 'anywhere' }}
              >
                <Stack>
                  <Title order={2}>{plan.title}</Title>
                  <Text>
                    {plan.startsOn} — {plan.endsOn}
                  </Text>
                  <Text style={{ whiteSpace: 'pre-wrap' }}>
                    {plan.description}
                  </Text>
                  <Group>
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
                    <Button
                      mih={44}
                      variant="light"
                      onClick={() =>
                        open({
                          kind: 'plan',
                          initial: planInput(plan),
                          existing: plan,
                        })
                      }
                    >
                      {m.edit}
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
                      {m.remove}
                    </Button>
                  </Group>
                  {plan.workouts.map((workout) => (
                    <Paper p="sm" withBorder key={workout.id}>
                      <Stack>
                        <Group justify="space-between">
                          <Title order={3}>{workout.title}</Title>
                          <Badge>{workout.date}</Badge>
                        </Group>
                        <ExerciseTable
                          exercises={workout.exercises}
                          sync={sync.items.find(
                            (item) =>
                              item.planId === plan.id &&
                              item.workoutId === workout.id,
                          )}
                        />
                        <WorkoutSync
                          item={sync.items.find(
                            (item) =>
                              item.planId === plan.id &&
                              item.workoutId === workout.id,
                          )}
                        />
                        {canLog && (
                          <Button
                            mih={44}
                            variant="light"
                            onClick={() => record(plan, workout)}
                          >
                            {m.record}
                          </Button>
                        )}
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <Stack>
            {data?.sessions.length === 0 &&
              !sync.items.some((item) => item.actual) && (
                <Text>{m.emptyHistory}</Text>
              )}
            {sync.items
              .filter((item) => item.actual)
              .map((item) => (
                <Paper withBorder p="md" key={item.id}>
                  <Stack>
                    <Title order={2}>{item.actual?.title}</Title>
                    <Text>{item.actual?.date}</Text>
                    <Text fw={600}>
                      {m.snapshot}: {item.planSnapshot.planTitle}
                    </Text>
                    <Text>
                      {item.planSnapshot.workout.title} ·{' '}
                      {item.planSnapshot.workout.date}
                    </Text>
                    <ExerciseTable
                      exercises={item.planSnapshot.workout.exercises}
                      sync={item}
                    />
                    <WorkoutSync item={item} />
                  </Stack>
                </Paper>
              ))}
            {data?.sessions
              .slice()
              .reverse()
              .map((session) => (
                <Paper
                  p="md"
                  withBorder
                  key={session.id}
                  data-testid={`session-${session.id}`}
                  style={{ overflowWrap: 'anywhere' }}
                >
                  <Stack>
                    <Group justify="space-between">
                      <Title order={2}>{session.title}</Title>
                      <Badge>{m[session.status]}</Badge>
                    </Group>
                    <Text>{session.date}</Text>
                    <Text>
                      {session.planSnapshot
                        ? `${m.snapshot}: ${session.planSnapshot.planTitle}`
                        : m.independent}
                    </Text>
                    {session.planSnapshot && (
                      <>
                        <Text fw={600}>{m.planned}</Text>
                        <ExerciseTable
                          exercises={session.planSnapshot.workout.exercises}
                        />
                      </>
                    )}
                    <Text fw={600}>{m.actual}</Text>
                    <ExerciseTable exercises={session.exercises} />
                    <Text style={{ whiteSpace: 'pre-wrap' }}>
                      {session.note}
                    </Text>
                    {canLog && (
                      <Group>
                        <Button
                          mih={44}
                          variant="light"
                          onClick={() =>
                            open({
                              kind: 'session',
                              initial: sessionInput(session),
                              existing: session,
                            })
                          }
                        >
                          {m.edit}
                        </Button>
                        <Button
                          mih={44}
                          color="red"
                          variant="subtle"
                          onClick={() => {
                            setEditorError(null);
                            setDeletion({
                              kind: 'sessions',
                              id: session.id,
                              revision: session.revision,
                            });
                          }}
                        >
                          {m.remove}
                        </Button>
                      </Group>
                    )}
                    {renderComments?.(session.id)}
                  </Stack>
                </Paper>
              ))}
          </Stack>
        </Tabs.Panel>
      </Tabs>
      <Modal
        opened={editor !== null}
        onClose={() => {
          if (!busy) setEditor(null);
        }}
        title={editor?.kind === 'plan' ? m.plans : m.newSession}
        size="lg"
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
        closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      >
        {editor?.kind === 'plan' && (
          <PlanForm
            ownerId={ownerId}
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
