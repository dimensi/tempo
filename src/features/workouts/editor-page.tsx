'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { z } from 'zod';
import { subscribeOfflineBlocked } from '@/lib/offline-device';
import {
  type WorkoutPlan,
  type WorkoutPlanInput,
  workoutPlanSchema,
} from '@/contracts/workouts';
import { PlanForm, emptyPlan } from './forms';
import {
  clearWorkoutDraft,
  clearWorkoutDrafts,
  readWorkoutDraft,
  storeWorkoutDraft,
} from './draft-storage';
import { WorkoutCreateChoice } from './create-choice';
import { copyPlanToDate } from './copy-plan';
import { workoutMessages as m } from './messages';
import classes from './workout-ui.module.css';

const draftExercise = z
  .object({
    name: z.string().max(160),
    comment: z.string().max(4000).optional(),
    transformMate: z
      .object({
        exerciseId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        occurrenceKey: z.uuid(),
      })
      .strict()
      .optional(),
    sets: z
      .array(
        z
          .object({
            reps: z.number().min(0).max(1000),
            weightKg: z.number().min(0).max(2000).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
const draftValue = z
  .object({
    title: z.string().max(160),
    description: z.string().max(4000),
    startsOn: z.string().max(10),
    endsOn: z.string().max(10),
    workouts: z
      .array(
        z
          .object({
            id: z.string().max(128),
            title: z.string().max(160),
            date: z.string().max(10),
            exercises: z.array(draftExercise).max(50),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export function WorkoutEditorPage({
  userId,
  ownerId,
  date,
  returnDate,
  plan,
  workoutId,
  copying,
  returnToView = false,
  canLog = false,
}: {
  userId: string;
  ownerId: string;
  date: string;
  returnDate: string;
  plan?: WorkoutPlan;
  workoutId?: string;
  copying: boolean;
  returnToView?: boolean;
  canLog?: boolean;
}) {
  const router = useRouter();
  const identity = `${userId}:${ownerId}`;
  const key = `workout-draft:${identity}:${copying ? 'copy' : 'edit'}:${plan?.id ?? 'new'}:${workoutId ?? ''}:${plan?.revision ?? 0}:${date}`;
  const [draft, setDraft] = useState<WorkoutPlanInput>(() => {
    if (plan) {
      const { title, description, startsOn, endsOn, workouts } = plan;
      const input = { title, description, startsOn, endsOn, workouts };
      const workout = workouts.find((item) => item.id === workoutId);
      return copying && workout
        ? copyPlanToDate(
            {
              title: workout.title,
              description: '',
              startsOn: workout.date,
              endsOn: workout.date,
              workouts: [workout],
            },
            date,
          )
        : input;
    } else {
      const initial = emptyPlan();
      initial.startsOn = initial.endsOn = date;
      initial.workouts[0]!.date = date;
      return initial;
    }
  });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  const requestId = useRef('');
  const mounted = useRef(false);
  const generation = useRef(0);
  const pendingPath = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const dirty = useRef(false);
  const persisted = useRef(false);
  const [stored, setStored] = useState(false);
  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    let alive = true;
    void fetch(`/api/workouts?ownerId=${encodeURIComponent(ownerId)}`, {
      cache: 'no-store',
    })
      .then((response) => {
        if (!alive) return;
        if (response.status === 401 || response.status === 403) {
          clearWorkoutDraft(key);
          throw new Error(m.noAccess);
        }
        if (!response.ok) throw new Error(m.loadError);
        if (!alive) return;
        requestId.current = crypto.randomUUID();
        const restored = readWorkoutDraft(key, identity, draftValue);
        if (restored) {
          setDraft(restored.value);
          setStored(true);
          persisted.current = true;
          requestId.current = restored.requestId;
          dirty.current = true;
        }
        setReady(true);
      })
      .catch((cause) => {
        if (!alive) return;
        setError(
          cause instanceof Error && cause.message === m.noAccess
            ? m.noAccess
            : m.loadError,
        );
      });
    const unsubscribe = subscribeOfflineBlocked(() => {
      clearWorkoutDrafts();
      setStored(false);
      persisted.current = false;
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current && !persisted.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted.current = false;
      generation.current += 1;
      alive = false;
      unsubscribe();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [key, identity, ownerId, attempt]);
  const leave = (destination = returnDate) => {
    dirty.current = false;
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Storage unavailable. */
    }
    if (mounted.current)
      router.push(
        returnToView && plan && workoutId
          ? `/workouts/plans/${plan.id}/workouts/${workoutId}?date=${destination}`
          : `/workouts?date=${destination}`,
      );
  };
  const change = (value: WorkoutPlanInput) => {
    dirty.current = true;
    setDraft(value);
    persisted.current = storeWorkoutDraft(key, requestId.current, value);
    setStored(persisted.current);
  };
  const save = async (value: WorkoutPlanInput) => {
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const editing = plan && !copying;
      const response = await fetch(
        `/api/workouts/plans${editing ? `/${plan.id}` : ''}?ownerId=${encodeURIComponent(ownerId)}`,
        {
          method: editing ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(!editing ? { 'Idempotency-Key': requestId.current } : {}),
          },
          body: JSON.stringify(
            editing ? { revision: plan.revision, data: value } : value,
          ),
        },
      );
      if (!mounted.current || current !== generation.current) return;
      if (!response.ok) {
        if (response.status === 403 || response.status === 401) {
          if (mounted.current) setReady(false);
          try {
            sessionStorage.removeItem(key);
          } catch {
            /* Storage unavailable. */
          }
        }
        throw new Error(
          response.status === 409
            ? m.conflict
            : response.status === 403
              ? m.noAccess
              : m.error,
        );
      }
      const result = await response.json();
      const saved = workoutPlanSchema.parse(result.data);
      const savedWorkout =
        saved.workouts.find((item) => item.id === workoutId) ??
        saved.workouts[0]!;
      if (!mounted.current || current !== generation.current) return;
      dirty.current = false;
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Storage unavailable. */
      }
      if (mounted.current)
        router.push(
          `/workouts/plans/${saved.id}/workouts/${savedWorkout.id}?date=${savedWorkout.date}`,
        );
    } catch (cause) {
      if (mounted.current && current === generation.current)
        setError(cause instanceof Error ? cause.message : m.error);
    } finally {
      if (mounted.current && current === generation.current) setBusy(false);
    }
  };
  return (
    <Stack className={classes.content} w="100%">
      <Group justify="space-between">
        <Title order={1}>
          {plan && !copying ? m.editWorkout : m.newWorkout}
        </Title>
        <Button
          mih={44}
          variant="subtle"
          disabled={busy}
          onClick={() => {
            if (dirty.current && !persisted.current) {
              setCancel(true);
              return;
            }
            router.push(
              returnToView && plan && workoutId
                ? `/workouts/plans/${plan.id}/workouts/${workoutId}?date=${returnDate}`
                : `/workouts?date=${returnDate}`,
            );
          }}
        >
          {m.back}
        </Button>
      </Group>
      {error && (
        <Alert role="alert" color="red">
          {error}
          {!ready && error !== m.noAccess && (
            <Button
              mih={44}
              variant="subtle"
              onClick={() => {
                setError(null);
                setAttempt(attempt + 1);
              }}
            >
              {m.refresh}
            </Button>
          )}
        </Alert>
      )}
      {ready && !plan && !copying && (
        <WorkoutCreateChoice
          kind="planned"
          date={
            z.iso.date().safeParse(draft.workouts[0]?.date).success
              ? draft.workouts[0]!.date
              : date
          }
          returnDate={returnDate}
          canLog={canLog}
          busy={busy}
          onNavigate={(path) => {
            if (dirty.current && !persisted.current) {
              pendingPath.current = path;
              setCancel(true);
            } else router.push(path);
          }}
        />
      )}
      {ready && (
        <PlanForm
          key={key}
          ownerId={ownerId}
          workoutId={copying || !plan ? draft.workouts[0]!.id : workoutId}
          initial={draft}
          preservePeriod={Boolean(plan && !copying)}
          onChange={change}
          busy={busy}
          error={null}
          onCancel={() => (dirty.current ? setCancel(true) : leave())}
          onSave={(value) => void save(value)}
        />
      )}
      {stored && (
        <Text size="sm" c="dimmed">
          {m.draftSaved}
        </Text>
      )}
      <Modal
        opened={cancel}
        onClose={() => {
          pendingPath.current = null;
          setCancel(false);
        }}
        title={m.discardQuestion}
        closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      >
        <Group>
          <Button
            mih={44}
            variant="default"
            onClick={() => {
              pendingPath.current = null;
              setCancel(false);
            }}
          >
            {m.keepEditing}
          </Button>
          <Button
            mih={44}
            color="red"
            onClick={() => {
              if (pendingPath.current) {
                clearWorkoutDraft(key);
                dirty.current = false;
                router.push(pendingPath.current);
              } else leave();
            }}
          >
            {m.discard}
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
