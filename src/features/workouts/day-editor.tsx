'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { z } from 'zod';
import { PageActions } from '@/components/layout/page-header';
import {
  workoutInputSchema,
  workoutSchema,
  type Workout,
  type WorkoutAction,
  type WorkoutInput,
} from '@/contracts/workouts';
import { apiFetch } from '@/lib/api-client';
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
  readLegacyWorkoutDraft,
} from './draft-storage';
import {
  emptyWorkoutDraft,
  workoutDraftSchema,
  type WorkoutDraft,
} from './workout-draft';
import { ExerciseRows } from './exercise-rows';
import { ExercisePicker } from './exercise-picker';
import { workoutMessages as m } from './messages';
import styles from './day-workout.module.css';
const envelopeSchema = z.object({
  revision: z.number().nullable(),
  value: workoutDraftSchema,
  recordId: z.string().optional(),
  alternative: workoutDraftSchema.optional(),
});
function DraftPreview({ draft }: { draft: WorkoutDraft }) {
  return (
    <Stack gap={4}>
      <Text fw={600}>{draft.title || m.workoutTitle}</Text>
      {draft.note && <Text size="sm">{draft.note}</Text>}
      {draft.exercises.map((exercise, index) => (
        <div key={exercise.id ?? index}>
          <Text size="sm">{exercise.name}</Text>
          <Text size="sm" c="dimmed">
            {exercise.sets
              .map((set) => `${set.weightKg ?? '—'} × ${set.reps ?? '—'}`)
              .join('; ')}
          </Text>
          {exercise.comment && <Text size="sm">{exercise.comment}</Text>}
        </div>
      ))}
    </Stack>
  );
}
export function DayEditor({
  ownerId,
  userId,
  date,
  workout,
  copy,
  onSaved,
  onCancel,
  renderComments,
  onDirtyChange,
  reordering = false,
  onReorderDone,
  canLog,
}: {
  ownerId: string;
  userId: string;
  date: string;
  workout?: Workout;
  copy?: WorkoutInput;
  canLog: boolean;
  onSaved: (background: boolean) => Promise<void>;
  onCancel?: () => void;
  renderComments?: (id: string) => ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
  reordering?: boolean;
  onReorderDone?: () => void;
}) {
  const initialWorkout = useRef(workout);
  const identity = `${userId}:${ownerId}`;
  const [recordId, setRecordId] = useState(
    () => workout?.id ?? crypto.randomUUID(),
  );
  const [key] = useState(() =>
    dayWorkoutDraftKey(identity, date, workout?.id ?? 'new'),
  );
  const [value, setValue] = useState<WorkoutDraft>(() =>
    workoutDraftSchema.parse(
      workout
        ? {
            date: workout.date,
            title: workout.title,
            note: workout.note,
            status: workout.status,
            exercises: workout.exercises,
          }
        : (copy ?? emptyWorkoutDraft(date)),
    ),
  );
  const current = useRef(value);
  const saved = useRef(workout);
  const [savedWorkout, setSavedWorkout] = useState(workout);
  const pendingAction = useRef<WorkoutAction | undefined>(undefined);
  const revision = useRef(workout?.revision);
  const [ready, setReady] = useState(false);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [status, setStatus] = useState('');
  const [stored, setStored] = useState(true);
  const [review, setReview] = useState<WorkoutDraft | null>(null);
  const [alternative, setAlternative] = useState<WorkoutDraft | null>(null);
  const [removal, setRemoval] = useState<WorkoutAction | 'save' | null>(null);
  const dirty = useRef(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const requestId = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef<
    (action?: WorkoutAction, allowRemoval?: boolean) => Promise<void>
  >(async () => {});
  const mobile = useMediaQuery('(max-width: 48em)');
  const editable =
    !busy &&
    value.status !== 'completed' &&
    (canLog || value.status === 'planned');
  function persist(next: WorkoutDraft) {
    const currentKey = saved.current
      ? dayWorkoutDraftKey(identity, date, saved.current.id)
      : key;
    const ok = storeWorkoutDraft(currentKey, requestId.current, {
      revision: revision.current ?? null,
      value: next,
      recordId,
    });
    setStored(ok);
    if (ok && currentKey !== key) clearWorkoutDraft(key);
  }
  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void commitRef.current(), 1200);
  }
  function change(next: WorkoutDraft) {
    current.current = next;
    setValue(next);
    sequence.current++;
    dirty.current = true;
    onDirtyChange?.(true);
    persist(next);
    schedule();
  }
  useEffect(() => {
    mounted.current = true;
    requestId.current = crypto.randomUUID();
    const restored = readWorkoutDraft(key, identity, envelopeSchema);
    const legacy = restored
      ? null
      : readLegacyWorkoutDraft(identity, date, initialWorkout.current);
    queueMicrotask(() => {
      if (!mounted.current) return;
      if (restored) {
        requestId.current = restored.requestId;
        if (restored.value.recordId) setRecordId(restored.value.recordId);
        if (restored.value.alternative)
          setAlternative(restored.value.alternative);
        if (
          restored.value.revision !== (initialWorkout.current?.revision ?? null)
        )
          setReview(restored.value.value);
        else {
          current.current = restored.value.value;
          setValue(current.current);
          dirty.current = true;
          schedule();
        }
      } else if (legacy) {
        setReview(legacy.value);
        setAlternative(legacy.alternative ?? null);
        requestId.current = legacy.requestId;
      }
      if (!restored && !legacy && !initialWorkout.current) {
        dirty.current = true;
        schedule();
      }
      setReady(true);
    });
    const unsubscribe = subscribeSessionReset(() => {
      clearWorkoutDrafts();
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [identity, key, date]);
  // Refresh only the revision for unchanged mounted forms; never replace live inputs.
  useEffect(() => {
    if (
      workout &&
      workout.id === recordId &&
      !dirty.current &&
      !pending.current
    ) {
      saved.current = workout;
      revision.current = workout.revision;
    }
  }, [workout, recordId]);
  async function commit(action?: WorkoutAction, allowRemoval = false) {
    if (pending.current) {
      if (action) pendingAction.current = action;
      return;
    }
    if (
      pending.current ||
      (review && action !== 'resume') ||
      (!dirty.current && !action) ||
      (!editable && !action)
    )
      return;
    const snapshot = current.current;
    const generation = sessionGeneration();
    const serial = sequence.current;
    const target =
      action === 'start' || action === 'resume'
        ? 'in_progress'
        : action === 'complete'
          ? 'completed'
          : snapshot.status;
    const parsed = workoutInputSchema.safeParse({
      ...snapshot,
      status: target,
    });
    if (
      !parsed.success ||
      ((action === 'start' || action === 'complete') &&
        (!parsed.data.exercises.length ||
          parsed.data.exercises.some((e) => !e.sets.length)))
    ) {
      setShowValidation(true);
      setError(action ? m.transitionValidation : m.resultValidation);
      return;
    }
    const removed = !!saved.current?.exercises.some(
      (e) => !parsed.data.exercises.some((next) => next.id === e.id),
    );
    if (removed && !allowRemoval) {
      setRemoval(action ?? 'save');
      return;
    }
    if (removed && !navigator.onLine) {
      setError(m.removeExerciseOffline);
      return;
    }
    pending.current = true;
    if (action) setBusy(true);
    setError(null);
    setStatus(m.saving);
    try {
      let next: Workout | undefined;
      let queued = false;
      if (canLog && !removed) {
        const writes = await readDeviceWrites();
        const local = writes.records.find((item) => item.id === recordId);
        if (local?.payload.kind === 'workout' && local.version)
          revision.current = Math.max(
            revision.current ?? 0,
            Number(local.version),
          );
        // A new record is always persisted planned before its first transition.
        if (action && !saved.current && !local) {
          const first = await saveDeviceWrite(
            { kind: 'workout', data: { ...parsed.data, status: 'planned' } },
            recordId,
          );
          const acknowledged = await synchronizeDeviceWrite(first);
          if (acknowledged) revision.current = Number(acknowledged.version);
        }
        const operation = await saveDeviceWrite(
          { kind: 'workout', data: parsed.data, ...(action ? { action } : {}) },
          recordId,
          revision.current ? String(revision.current) : undefined,
        );
        const result = await synchronizeDeviceWrite(operation);
        queued = !result;
        if (result) {
          revision.current = Number(result.version);
          next = {
            ...parsed.data,
            id: recordId,
            ownerId,
            revision: revision.current,
            ...(saved.current?.legacySource
              ? { legacySource: saved.current.legacySource }
              : {}),
            createdAt: saved.current?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
      } else {
        if (canLog && removed) {
          const writes = await readDeviceWrites();
          if (
            writes.operations.some(
              (item) =>
                item.operation.recordId === recordId &&
                item.status !== 'synced',
            )
          )
            throw new Error(m.queued);
        }
        const prior = saved.current;
        const response = await apiFetch(
          `/api/workouts${prior ? `/${prior.id}${action ? '/transition' : ''}` : ''}`,
          {
            method: prior ? (action ? 'POST' : 'PUT') : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ownerId,
              requestId: requestId.current,
              ...(prior ? { revision: revision.current } : {}),
              data: parsed.data,
              ...(action ? { action } : {}),
            }),
          },
        );
        if (!response.ok)
          throw new Error(response.status === 409 ? m.conflict : m.error);
        next = workoutSchema.parse((await response.json()).data);
        revision.current = next.revision;
      }
      if (!mounted.current || generation !== sessionGeneration()) return;
      if (next) {
        saved.current = next;
        setSavedWorkout(next);
      }
      if (sequence.current === serial) {
        current.current = { ...snapshot, status: target };
        setValue(current.current);
        dirty.current = false;
        onDirtyChange?.(false);
      } else if (action) {
        current.current = { ...current.current, status: target };
        setValue(current.current);
      }
      requestId.current = crypto.randomUUID();
      persist(current.current);
      setStatus(dirty.current ? m.unsaved : queued ? m.queued : m.saved);
      if (!queued) await onSaved(true);
    } catch (cause) {
      if (mounted.current && generation === sessionGeneration()) {
        setError(cause instanceof Error ? cause.message : m.error);
        setStatus(m.unsaved);
      }
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        const followup = pendingAction.current;
        pendingAction.current = undefined;
        if (followup) queueMicrotask(() => void commitRef.current(followup));
        else if (dirty.current && sequence.current !== serial) schedule();
      }
    }
  }
  useEffect(() => {
    commitRef.current = commit;
  });
  if (!ready) return null;
  const action: WorkoutAction =
    value.status === 'planned'
      ? 'start'
      : value.status === 'in_progress'
        ? 'complete'
        : 'resume';
  return (
    <Stack gap="md">
      <PageActions>
        {canLog && (
          <Button
            mih={44}
            loading={busy}
            disabled={!!review && action !== 'resume'}
            onClick={() => void commit(action)}
          >
            {action === 'start'
              ? m.startWorkout
              : action === 'complete'
                ? m.completeWorkout
                : m.resumeWorkout}
          </Button>
        )}
      </PageActions>
      <Text size="sm" c="dimmed">
        {value.status === 'planned' ? m.plannedStatus : m[value.status]}
      </Text>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {review && (
        <Alert color="orange">
          <Stack gap="xs">
            <Text>{m.draftReview}</Text>
            <DraftPreview draft={review} />
            {alternative && (
              <>
                <Text fw={600}>{m.legacyPlanDraft}</Text>
                <DraftPreview draft={alternative} />
              </>
            )}
            <Group>
              <Button
                onClick={() => {
                  setReview(null);
                  change({ ...review, status: current.current.status });
                }}
                disabled={!editable}
              >
                {m.applyDraft}
              </Button>
              {alternative && (
                <Button
                  disabled={!editable}
                  variant="default"
                  onClick={() => {
                    setReview(null);
                    setAlternative(null);
                    change({ ...alternative, status: current.current.status });
                  }}
                >
                  {m.applyLegacyPlan}
                </Button>
              )}
              <Button
                variant="default"
                onClick={() => {
                  setReview(null);
                  persist(current.current);
                }}
              >
                {m.keepCurrent}
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}
      {!stored && <Alert color="orange">{m.draftUnavailable}</Alert>}
      {reordering && editable && (
        <Group justify="space-between">
          <Text>{m.reorderExercises}</Text>
          <Button onClick={onReorderDone}>{m.reorderDone}</Button>
        </Group>
      )}
      <Text className={styles.status} role="status" aria-live="polite">
        {status || '\u00a0'}
      </Text>
      <TextInput
        label={m.workoutTitle}
        value={value.title}
        maxLength={160}
        readOnly={!editable}
        onChange={(e) =>
          change({ ...current.current, title: e.currentTarget.value })
        }
      />
      <Textarea
        label={m.workoutNote}
        value={value.note}
        maxLength={12000}
        autosize
        minRows={1}
        maxRows={6}
        readOnly={!editable}
        onChange={(e) =>
          change({ ...current.current, note: e.currentTarget.value })
        }
      />
      <ExerciseRows
        ownerId={ownerId}
        canLog={canLog}
        exercises={value.exercises}
        session={savedWorkout}
        mode={editable ? 'edit' : 'read'}
        showValidation={showValidation}
        reordering={reordering && editable}
        onChange={
          editable
            ? (exercises) => change({ ...current.current, exercises })
            : undefined
        }
      />
      {editable && (
        <Button
          className={styles.addExercise}
          variant="light"
          mih={48}
          leftSection={<IconPlus size={19} />}
          disabled={value.exercises.length >= 50}
          onClick={() => setPicker(true)}
        >
          {m.addExercises}
        </Button>
      )}
      {editable && error && (
        <Button variant="default" onClick={() => void commit()}>
          {m.save}
        </Button>
      )}
      {onCancel && !savedWorkout && (
        <Button variant="subtle" onClick={onCancel}>
          {m.cancel}
        </Button>
      )}
      {savedWorkout && renderComments?.(savedWorkout.id)}
      <Modal
        opened={picker && editable}
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
            capacity={50 - value.exercises.length}
            onAdd={(exercises) => {
              change({
                ...current.current,
                exercises: [...current.current.exercises, ...exercises],
              });
              setPicker(false);
            }}
          />
        )}
      </Modal>
      <Modal
        opened={removal !== null}
        onClose={() => setRemoval(null)}
        title={m.removeActual}
      >
        <Stack>
          <Text>{m.confirmResultRemoval}</Text>
          <Button
            color="red"
            onClick={() => {
              const next = removal;
              setRemoval(null);
              void commit(
                next === 'save' || next === null ? undefined : next,
                true,
              );
            }}
          >
            {m.confirmDelete}
          </Button>
          <Button variant="default" onClick={() => setRemoval(null)}>
            {m.cancel}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
