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
  Button,
  Group,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
  Modal,
} from '@mantine/core';
import { IconCircleCheckFilled, IconPlus } from '@tabler/icons-react';
import { PageActions } from '@/components/layout/page-header';
import { useMediaQuery } from '@mantine/hooks';
import { z } from 'zod';
import {
  workoutPlanInputSchema,
  workoutExerciseSchema,
  plannedWorkoutSchema,
  workoutSessionInputSchema,
  type WorkoutPlan,
  type PlannedWorkout,
  type WorkoutSession,
} from '@/contracts/workouts';
import { apiFetch } from '@/lib/api-client';
import { readResources } from '@/lib/read-descriptors';
import { apiResults } from '@/lib/api-results';
import {
  readDeviceWrites,
  saveDeviceWrite,
  synchronizeDeviceWrite,
} from '@/lib/offline-write-client';
import { subscribeSessionReset } from '@/lib/offline-device';
import { sessionGeneration } from '@/lib/session-state';
import {
  clearWorkoutDraft,
  clearWorkoutDrafts,
  dayWorkoutDraftKey,
  readWorkoutDraft,
  storeWorkoutDraft,
} from './draft-storage';
import {
  emptyResultDraft,
  resultDraftSchema,
  type ResultDraft,
} from './result-draft';
import { ExerciseRows } from './exercise-rows';
import { matchExerciseGuides } from './exercise-guides';
import { ExercisePicker } from './exercise-picker';
import { workoutMessages as m } from './messages';
import styles from './day-workout.module.css';

const draftSchema = z.object({
  planRevision: z.number().int().positive().nullable(),
  sessionRevision: z.number().int().positive().nullable(),
  planDirty: z.boolean(),
  resultDirty: z.boolean(),
  plan: workoutPlanInputSchema.safeExtend({
    workouts: z
      .array(
        plannedWorkoutSchema.safeExtend({
          exercises: z
            .array(
              workoutExerciseSchema.safeExtend({
                sets: z
                  .array(
                    z.object({
                      reps: z.number().min(0).max(1000),
                      weightKg: z.number().min(0).max(2000).nullable(),
                    }),
                  )
                  .min(1)
                  .max(50),
              }),
            )
            .max(50),
        }),
      )
      .min(1)
      .max(100),
  }),
  result: resultDraftSchema,
});

function initialResult(
  date: string,
  workout: PlannedWorkout,
  existing?: WorkoutSession,
): ResultDraft {
  if (!existing)
    return { ...emptyResultDraft(date, workout), status: 'in_progress' };
  // Keep the immutable result IDs (including private-video references) and retain
  // unrecorded planned rows as empty inputs, never manufacture actual values.
  const exercises = existing.exercises.map((exercise) =>
    structuredClone(exercise),
  );
  const guides = matchExerciseGuides(exercises, workout.exercises);
  const matched = new Set(guides);
  for (const guide of workout.exercises) {
    if (!matched.has(guide)) {
      exercises.push({
        ...structuredClone(guide),
        id: crypto.randomUUID(),
        sets: [],
      });
      guides.push(guide);
    }
  }
  return {
    title: existing.title,
    date: existing.date,
    note: existing.note,
    status: existing.status,
    exercises: exercises.map((exercise, index) => {
      const guide = guides[index];
      return {
        ...exercise,
        sets: [
          ...exercise.sets,
          ...Array.from(
            {
              length: Math.max(
                0,
                (guide?.sets.length ?? 1) - exercise.sets.length,
              ),
            },
            () => ({ reps: null, weightKg: null }),
          ),
        ],
      };
    }),
  };
}

export function DayEditor({
  ownerId,
  userId,
  date,
  plan,
  workout,
  existing,
  canLog,
  createMode = 'plan',
  onSaved,
  onCancel,
  renderComments,
  onDirtyChange,
  reordering = false,
  onReorderDone,
}: {
  ownerId: string;
  userId: string;
  date: string;
  plan?: WorkoutPlan;
  workout?: PlannedWorkout;
  existing?: WorkoutSession;
  canLog: boolean;
  createMode?: 'plan' | 'result';
  onSaved: () => Promise<void>;
  onCancel?: () => void;
  renderComments?: (id: string) => ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
  reordering?: boolean;
  onReorderDone?: () => void;
}) {
  const [initial] = useState(() => {
    const selected = workout ??
      existing?.planSnapshot?.workout ?? {
        id: crypto.randomUUID(),
        title: existing?.title ?? '',
        date,
        exercises: existing?.exercises ?? [],
      };
    return {
      plan: plan
        ? {
            title: plan.title,
            description: plan.description,
            startsOn: plan.startsOn,
            endsOn: plan.endsOn,
            workouts: structuredClone(plan.workouts),
          }
        : {
            title: '',
            description: '',
            startsOn: date,
            endsOn: date,
            workouts: [structuredClone(selected)],
          },
      result: initialResult(
        date,
        existing?.planSnapshot?.workout ?? selected,
        existing,
      ),
      workoutId: selected.id,
    };
  });
  const identity = `${userId}:${ownerId}`;
  const [key] = useState(() =>
    dayWorkoutDraftKey(
      identity,
      date,
      plan?.id ?? existing?.id ?? 'new',
      workout?.id,
    ),
  );
  const [value, setValue] = useState({
    plan: initial.plan,
    result: initial.result,
  });
  const valueRef = useRef(value);
  const [selectedMode, setMode] = useState(
    !plan && !existing
      ? createMode
      : plan && !canLog && !existing
        ? 'plan'
        : 'result',
  );
  const mode = reordering && !canLog ? 'plan' : selectedMode;
  const [ready, setReady] = useState(false);
  const [picker, setPicker] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [removalStatus, setRemovalStatus] = useState<ResultDraft['status']>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [stored, setStored] = useState(true);
  const [savedSession, setSavedSession] = useState(existing);
  const [hasQueuedWrite, setHasQueuedWrite] = useState(false);
  const sessionRef = useRef(existing);
  const planRef = useRef(plan);
  const [hasPlan, setHasPlan] = useState(!!plan);
  const [draftConflict, setDraftConflict] = useState(false);
  const dirty = useRef(false);
  const planDirty = useRef(false);
  const resultDirty = useRef(false);
  const staleDraft = useRef(false);
  const mounted = useRef(false);
  const requestId = useRef('');
  const pending = useRef(false);
  const lastSaved = useRef('');
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobile = useMediaQuery('(max-width: 48em)');
  const selected =
    value.plan.workouts.find((item) => item.id === initial.workoutId) ??
    value.plan.workouts[0]!;
  const totalSets = value.result.exercises.reduce(
    (count, exercise) => count + exercise.sets.length,
    0,
  );
  const recordedSets = value.result.exercises.reduce(
    (count, exercise) =>
      count + exercise.sets.filter((set) => set.reps !== null && set.reps > 0).length,
    0,
  );
  const persist = useCallback(
    (next: typeof value) =>
      storeWorkoutDraft(key, requestId.current, {
        ...next,
        planRevision: planRef.current?.revision ?? null,
        sessionRevision: sessionRef.current?.revision ?? null,
        planDirty: planDirty.current,
        resultDirty: resultDirty.current,
      }),
    [key],
  );
  useEffect(() => {
    mounted.current = true;
    const restored = readWorkoutDraft(key, identity, draftSchema);
    queueMicrotask(() => {
      if (!mounted.current) return;
      requestId.current = restored?.requestId ?? crypto.randomUUID();
      if (restored) {
        const restoredValue = {
          plan: restored.value.plan,
          result: restored.value.result,
        };
        setValue(restoredValue);
        valueRef.current = restoredValue;
        planDirty.current = restored.value.planDirty;
        resultDirty.current = restored.value.resultDirty;
        dirty.current = planDirty.current || resultDirty.current;
        staleDraft.current =
          restored.value.planRevision !== (planRef.current?.revision ?? null) ||
          restored.value.sessionRevision !==
            (sessionRef.current?.revision ?? null);
        setDraftConflict(staleDraft.current);
        if (planDirty.current) setMode('plan');
        if (staleDraft.current) setError(m.conflict);
        setStatus(dirty.current ? m.unsaved : '');
      }
      setReady(true);
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current && !persist(valueRef.current)) event.preventDefault();
    };
    const reset = subscribeSessionReset(() => {
      clearWorkoutDrafts();
      dirty.current = false;
    });
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted.current = false;
      reset();
      window.removeEventListener('beforeunload', beforeUnload);
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, [key, identity, persist]);
  useEffect(() => {
    if (
      !ready ||
      !existing ||
      existing.id !== (sessionRef.current?.id ?? requestId.current) ||
      existing.revision <= (sessionRef.current?.revision ?? 0)
    )
      return;
    const acknowledged = {
      date: existing.date,
      title: existing.title,
      exercises: existing.exercises,
      note: existing.note,
      status: existing.status,
    };
    // Only rebase on the payload we saved, preserving conflicts with unrelated edits.
    if (JSON.stringify(acknowledged) !== lastSaved.current) return;
    sessionRef.current = existing;
    const generation = sessionGeneration();
    queueMicrotask(() => {
      if (
        !mounted.current ||
        generation !== sessionGeneration() ||
        sessionRef.current !== existing
      )
        return;
      setSavedSession(existing);
      setStored(persist(valueRef.current));
    });
  }, [existing, persist, ready]);
  const change = (next: typeof value, kind: 'plan' | 'result') => {
    valueRef.current = next;
    setValue(next);
    dirty.current = true;
    if (kind === 'plan') planDirty.current = true;
    else resultDirty.current = true;
    setStored(persist(next));
    setStatus(m.unsaved);
    if (kind === 'result' && canLog) {
      if (autoTimer.current) clearTimeout(autoTimer.current);
      autoTimer.current = setTimeout(
        () => void saveResult(undefined, false),
        800,
      );
    }
  };
  useEffect(() => {
    onDirtyChange?.(dirty.current);
  }, [value, status, busy, onDirtyChange]);
  async function savePlan() {
    if (pending.current || staleDraft.current) return;
    const parsed = workoutPlanInputSchema.safeParse(valueRef.current.plan);
    if (!parsed.success) {
      setError(m.validation);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    const generation = sessionGeneration();
    try {
      const currentPlan = planRef.current;
      const response = await apiFetch(
        `/api/workouts/plans${currentPlan ? `/${currentPlan.id}` : ''}?ownerId=${encodeURIComponent(ownerId)}`,
        {
          method: currentPlan ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(!currentPlan ? { 'Idempotency-Key': requestId.current } : {}),
          },
          body: JSON.stringify(
            currentPlan
              ? { revision: currentPlan.revision, data: parsed.data }
              : parsed.data,
          ),
        },
      );
      if (!response.ok)
        throw new Error(response.status === 409 ? m.conflict : m.error);
      const saved = apiResults.plan((await response.json()).data);
      if (!mounted.current || generation !== sessionGeneration()) return;
      planRef.current = saved;
      setHasPlan(true);
      planDirty.current = false;
      const savedWorkout = saved.workouts.find(
        (item) => item.id === selected.id,
      )!;
      const nextResult = structuredClone(valueRef.current.result);
      const matched = new Set(
        matchExerciseGuides(nextResult.exercises, savedWorkout.exercises),
      );
      for (const exercise of savedWorkout.exercises) {
        if (!matched.has(exercise))
          nextResult.exercises.push({
            ...structuredClone(exercise),
            id: crypto.randomUUID(),
            sets: exercise.sets.map(() => ({ reps: null, weightKg: null })),
          });
      }
      const next = { plan: valueRef.current.plan, result: nextResult };
      valueRef.current = next;
      setValue(next);
      dirty.current = resultDirty.current;
      if (!plan && !existing) clearWorkoutDraft(key);
      else setStored(persist(next));
      setStatus(resultDirty.current ? m.unsaved : m.planSaved);
      await onSaved();
    } catch (cause) {
      if (mounted.current && generation === sessionGeneration())
        setError(cause instanceof Error ? cause.message : m.error);
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        if (
          generation === sessionGeneration() &&
          canLog &&
          resultDirty.current
        ) {
          if (autoTimer.current) clearTimeout(autoTimer.current);
          autoTimer.current = setTimeout(
            () => void saveResult(undefined, false),
            250,
          );
        }
      }
    }
  }
  async function saveResult(
    nextStatus?: ResultDraft['status'],
    explicit = true,
    allowRemoval = false,
    statusOnly = false,
  ) {
    if (!canLog || pending.current || staleDraft.current) return;
    pending.current = true;
    const generation = sessionGeneration();
    const snapshot = valueRef.current;
    if (statusOnly && autoTimer.current) clearTimeout(autoTimer.current);
    setBusy(true);
    try {
      const prior = sessionRef.current;
      let expectedBase = prior ? String(prior.revision) : undefined;
      let draft: ResultDraft = snapshot.result;
      if (statusOnly) {
        // Change status against acknowledged data, never against unsaved form fields.
        // A durable local save may be newer than the last server response.
        const writes =
          userId === ownerId ? await readDeviceWrites() : undefined;
        if (!mounted.current || generation !== sessionGeneration()) return;
        const recordId = prior?.id ?? requestId.current;
        const hasPending = writes?.operations.some(
          (item) =>
            item.operation.recordId === recordId && item.status !== 'synced',
        );
        const local = writes?.records.find((item) => item.id === recordId);
        const latest =
          local?.payload.kind === 'workout' &&
          (hasPending || Number(local.version) >= (prior?.revision ?? 0))
            ? local
            : undefined;
        const saved =
          latest?.payload.kind === 'workout' ? latest.payload.data : prior;
        if (!saved) return;
        if (latest) expectedBase = latest.version || undefined;
        draft = {
          title: saved.title,
          date: saved.date,
          note: saved.note,
          status: saved.status,
          exercises: saved.exercises,
        };
      }
      const started = draft.exercises.some((exercise) =>
        exercise.sets.some((set) => set.reps !== null || set.weightKg !== null),
      );
      if (!started && !nextStatus && !sessionRef.current) return;
      if (
        draft.exercises.some((exercise) =>
          exercise.sets.some(
            (set) =>
              (set.weightKg !== null || set.reps !== null) &&
              (!set.reps || !Number.isInteger(set.reps)),
          ),
        )
      ) {
        if (explicit) setError(m.resultValidation);
        return;
      }
      const input = workoutSessionInputSchema.safeParse({
        ...draft,
        status: nextStatus ?? draft.status,
        exercises: draft.exercises
          .map((exercise) => ({
            ...exercise,
            sets: exercise.sets.filter((set) => set.reps !== null),
          }))
          .filter(
            (exercise) =>
              statusOnly ||
              exercise.sets.length > 0 ||
              Boolean(exercise.comment) ||
              prior?.exercises.some((item) => item.id === exercise.id),
          ),
      });
      if (!input.success) {
        if (explicit) setError(m.resultValidation);
        return;
      }
      const serialized = JSON.stringify(input.data);
      if (serialized === lastSaved.current) {
        if (!statusOnly) {
          resultDirty.current = false;
          dirty.current = planDirty.current;
          setStored(persist(valueRef.current));
          setError(null);
          setStatus(dirty.current ? m.unsaved : m.saved);
        }
        return;
      }
      setError(null);
      setStatus(m.saving);
      const sameOccurrences =
        !prior ||
        prior.exercises.every((item) =>
          input.data.exercises.some((next) => next.id === item.id),
        );
      if (!sameOccurrences && !allowRemoval) {
        setStatus(m.unsaved);
        setError(m.confirmResultRemoval);
        if (explicit) {
          setRemovalStatus(nextStatus);
          setConfirmRemoval(true);
        }
        return;
      }
      const currentPlan = planRef.current;
      let saved: WorkoutSession | undefined;
      let queued = false;
      if (userId === ownerId && sameOccurrences) {
        const operation = await saveDeviceWrite(
          {
            kind: 'workout',
            data: {
              ...input.data,
              ...(currentPlan
                ? {
                    planId: currentPlan.id,
                    plannedWorkoutId: selected.id,
                  }
                : {}),
            },
            ...(currentPlan ? { planRevision: currentPlan.revision } : {}),
          },
          prior?.id ?? requestId.current,
          expectedBase,
        );
        const result = await synchronizeDeviceWrite(operation);
        if (result?.payload.kind === 'workout') {
          const response = await apiFetch(
            `/api/workouts?ownerId=${encodeURIComponent(ownerId)}`,
          );
          if (!response.ok) throw new Error(m.loadError);
          const body = readResources
            .workouts(undefined)
            .decode(await response.text());
          saved = body.sessions.find((item) => item.id === result.id);
          if (!saved) throw new Error(m.loadError);
        } else queued = true;
      } else {
        const response = await apiFetch(
          `/api/workouts/sessions${prior ? `/${prior.id}` : ''}?ownerId=${encodeURIComponent(ownerId)}`,
          {
            method: prior ? 'PUT' : 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': requestId.current,
            },
            body: JSON.stringify(
              prior
                ? { revision: prior.revision, data: input.data }
                : input.data,
            ),
          },
        );
        if (!response.ok)
          throw new Error(response.status === 409 ? m.conflict : m.error);
        saved = apiResults.session((await response.json()).data);
      }
      if (!mounted.current || generation !== sessionGeneration()) return;
      if (saved) {
        sessionRef.current = saved;
        setSavedSession(saved);
      }
      lastSaved.current = serialized;
      const acknowledged = valueRef.current.result === snapshot.result;
      if (acknowledged || statusOnly) {
        const next = {
          ...valueRef.current,
          result: { ...valueRef.current.result, status: input.data.status },
        };
        valueRef.current = next;
        setValue(next);
        if (!statusOnly) resultDirty.current = false;
      }
      dirty.current = planDirty.current || resultDirty.current;
      setStored(persist(valueRef.current));
      setStatus(resultDirty.current ? m.unsaved : queued ? m.queued : m.saved);
      await onSaved();
    } catch (cause) {
      if (mounted.current && generation === sessionGeneration()) {
        setError(cause instanceof Error ? cause.message : m.error);
        setStatus(m.unsaved);
      }
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        if (
          generation === sessionGeneration() &&
          !statusOnly &&
          valueRef.current.result !== snapshot.result &&
          resultDirty.current
        ) {
          if (autoTimer.current) clearTimeout(autoTimer.current);
          autoTimer.current = setTimeout(
            () => void saveResult(undefined, false),
            250,
          );
        }
      }
    }
  }
  if (!ready) return null;
  return (
    <Stack gap="md">
      <PageActions>
        {(mode === 'plan' || value.result.status !== 'completed') && (
          <Button
            mih={44}
            variant="filled"
            aria-label={mode === 'plan' ? m.savePlan : m.finishWorkout}
            loading={busy}
            disabled={
              mode === 'plan'
                ? !selected.exercises.length
                : !canLog || !value.result.exercises.length
            }
            onClick={() =>
              mode === 'plan' ? void savePlan() : void saveResult('completed')
            }
          >
            {mode === 'plan' ? m.save : m.finishShort}
          </Button>
        )}
      </PageActions>
      <div className={styles.toolbar}>
        {hasPlan ? (
          <SegmentedControl
            aria-label={m.dayWorkout}
            value={mode}
            onChange={setMode}
            disabled={reordering}
            data={[
              { value: 'result', label: m.execution },
              { value: 'plan', label: m.prepare },
            ]}
            styles={{
              label: { minHeight: 44, display: 'flex', alignItems: 'center' },
            }}
          />
        ) : (
          <Text fw={650}>
            {mode === 'result' ? m.execution : m.startPlan}
          </Text>
        )}
        <Group gap="xs">
          <Group
            gap={6}
            c={
              savedSession && value.result.status === 'completed'
                ? 'var(--mantine-primary-color-light-color)'
                : 'dimmed'
            }
          >
            {savedSession && value.result.status === 'completed' && (
              <IconCircleCheckFilled size={24} aria-hidden />
            )}
            <Text
              size="sm"
              fw={
                savedSession && value.result.status === 'completed' ? 600 : 400
              }
            >
              {savedSession
                ? m[value.result.status]
                : mode === 'result'
                  ? m.in_progress
                  : m.plannedStatus}
            </Text>
          </Group>
          {mode !== 'plan' && value.result.status === 'completed' && canLog && (
            <Button
              variant="default"
              color="gray"
              size="sm"
              mih={44}
              loading={busy}
              aria-label={m.reopenWorkout}
              onClick={() => void saveResult('in_progress', true, false, true)}
            >
              {m.undoCompletion}
            </Button>
          )}
        </Group>
      </div>
      {error && (
        <Alert color="red" role="alert">
          {error}
          {draftConflict && (
            <Button
              variant="subtle"
              onClick={() => {
                clearWorkoutDraft(key);
                window.location.reload();
              }}
            >
              {m.discardAndReload}
            </Button>
          )}
        </Alert>
      )}
      {!stored && <Alert color="orange">{m.draftUnavailable}</Alert>}
      {reordering && (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" fw={600}>
            {m.reorderExercises}
          </Text>
          <Button
            variant="light"
            onClick={onReorderDone}
            style={{ flexShrink: 0 }}
          >
            {m.reorderDone}
          </Button>
        </Group>
      )}
      {status && (
        <Text className={styles.status} role="status">
          {status}
        </Text>
      )}
      {mode !== 'plan' && totalSets > 0 && (
        <div className={styles.sessionProgress}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="sm" fw={650}>
              {m.recordedSets}
            </Text>
            <Text size="sm" c="dimmed" className={styles.progressCount}>
              {recordedSets} / {totalSets}
            </Text>
          </Group>
          <Progress
            value={(recordedSets / totalSets) * 100}
            size={5}
            color="teal"
            aria-label={`${m.recordedSets}: ${recordedSets} / ${totalSets}`}
          />
        </div>
      )}
      {mode === 'plan' ? (
        <>
          {!selected.exercises.length && (
            <Text c="dimmed">{m.prepareHint}</Text>
          )}
          <Stack gap="sm">
            <TextInput
              disabled={busy}
              label={m.planName}
              value={value.plan.title}
              maxLength={160}
              onChange={(e) =>
                change(
                  {
                    ...value,
                    plan: { ...value.plan, title: e.currentTarget.value },
                  },
                  'plan',
                )
              }
            />
            <TextInput
              disabled={busy}
              label={m.optionalTitle}
              value={selected.title}
              maxLength={160}
              onChange={(e) =>
                change(
                  {
                    ...value,
                    plan: {
                      ...value.plan,
                      workouts: value.plan.workouts.map((item) =>
                        item.id === selected.id
                          ? { ...item, title: e.currentTarget.value }
                          : item,
                      ),
                    },
                  },
                  'plan',
                )
              }
            />
            <Textarea
              disabled={busy}
              label={m.descriptionLabel}
              value={value.plan.description}
              maxLength={4000}
              onChange={(e) =>
                change(
                  {
                    ...value,
                    plan: {
                      ...value.plan,
                      description: e.currentTarget.value,
                    },
                  },
                  'plan',
                )
              }
            />
          </Stack>
          <ExerciseRows
            ownerId={ownerId}
            canLog={canLog}
            reordering={reordering}
            exercises={selected.exercises}
            mode="plan"
            session={savedSession}
            disabled={busy}
            onChange={(exercises) =>
              change(
                {
                  ...value,
                  plan: {
                    ...value.plan,
                    workouts: value.plan.workouts.map((item) =>
                      item.id === selected.id
                        ? {
                            ...item,
                            exercises: exercises.map((exercise) => ({
                              ...exercise,
                              sets: exercise.sets.map((set) => ({
                                ...set,
                                reps: set.reps ?? 0,
                              })),
                            })),
                          }
                        : item,
                    ),
                  },
                },
                'plan',
              )
            }
          />
          <Button
            variant="light"
            mih={44}
            onClick={() => setPicker(true)}
            disabled={busy || selected.exercises.length >= 50}
          >
            {m.addExercises}
          </Button>
          {onCancel && (
            <Button
              variant="subtle"
              mih={44}
              disabled={busy}
              onClick={() => {
                clearWorkoutDraft(key);
                onCancel();
              }}
            >
              {m.cancel}
            </Button>
          )}
        </>
      ) : (
        <>
          {!hasPlan && (
            <TextInput
              label={m.resultTitle}
              value={value.result.title}
              maxLength={160}
              disabled={!canLog}
              onChange={(e) =>
                change(
                  {
                    ...value,
                    result: { ...value.result, title: e.currentTarget.value },
                  },
                  'result',
                )
              }
            />
          )}
          <Textarea
            label={m.workoutNote}
            autosize
            minRows={1}
            maxRows={6}
            maxLength={4000}
            disabled={!canLog}
            value={value.result.note}
            onChange={(e) =>
              change(
                {
                  ...value,
                  result: { ...value.result, note: e.currentTarget.value },
                },
                'result',
              )
            }
          />
          {!savedSession && (
            <Text size="sm" c="dimmed">
              {m.noResultYet}
            </Text>
          )}
          <ExerciseRows
            ownerId={ownerId}
            canLog={canLog}
            reordering={reordering}
            exercises={value.result.exercises}
            planned={
              savedSession?.planSnapshot?.workout ??
              (hasPlan ? selected : undefined)
            }
            session={savedSession}
            mode={canLog ? 'result' : 'read'}
            disabled={busy}
            onChange={
              canLog
                ? (exercises) =>
                    change(
                      { ...value, result: { ...value.result, exercises } },
                      'result',
                    )
                : undefined
            }
          />
          {canLog && (
            <Button
              className={styles.addExercise}
              variant="light"
              mih={48}
              leftSection={<IconPlus size={19} />}
              disabled={busy || value.result.exercises.length >= 50}
              onClick={() => setPicker(true)}
            >
              {m.addExercises}
            </Button>
          )}
          {onCancel && !savedSession && !hasQueuedWrite && (
            <Button
              variant="subtle"
              mih={44}
              disabled={busy}
              onClick={() => {
                clearWorkoutDraft(key);
                onCancel();
              }}
            >
              {m.cancel}
            </Button>
          )}
          {error && canLog && (
            <Button
              variant="default"
              mih={44}
              disabled={busy}
              onClick={() => void saveResult()}
            >
              {m.saveResults}
            </Button>
          )}
          {savedSession && renderComments?.(savedSession.id)}
        </>
      )}
      <Modal
        opened={picker}
        onClose={() => setPicker(false)}
        fullScreen={mobile}
        size={1000}
        centered
        title={m.selectExercises}
        closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      >
        {picker && (
          <ExercisePicker
            ownerId={ownerId}
            capacity={
              50 -
              (mode === 'plan'
                ? selected.exercises.length
                : value.result.exercises.length)
            }
            onAdd={(exercises) => {
              if (mode === 'result') {
                change(
                  {
                    ...value,
                    result: {
                      ...value.result,
                      exercises: [
                        ...value.result.exercises,
                        ...exercises.map((exercise) => ({
                          ...exercise,
                          sets: [{ reps: null, weightKg: null }],
                        })),
                      ],
                    },
                  },
                  'result',
                );
                setPicker(false);
                return;
              }
              change(
                {
                  ...value,
                  plan: {
                    ...value.plan,
                    workouts: value.plan.workouts.map((item) =>
                      item.id === selected.id
                        ? {
                            ...item,
                            exercises: [...item.exercises, ...exercises],
                          }
                        : item,
                    ),
                  },
                },
                'plan',
              );
              setPicker(false);
            }}
          />
        )}
      </Modal>
      <Modal
        opened={confirmRemoval}
        onClose={() => setConfirmRemoval(false)}
        title={m.removeActual}
      >
        <Stack>
          <Text>{m.confirmResultRemoval}</Text>
          <Button
            color="red"
            onClick={() => {
              setConfirmRemoval(false);
              void saveResult(removalStatus, true, true);
            }}
          >
            {m.confirmDelete}
          </Button>
          <Button variant="default" onClick={() => setConfirmRemoval(false)}>
            {m.cancel}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
