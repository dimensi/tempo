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
import { copyPlanToDate } from './copy-plan';
import { workoutMessages as m } from './messages';

const draftExercise = z
  .object({
    name: z.string().max(160),
    comment: z.string().max(4000).optional(),
    transformMate: z
      .object({
        exerciseId: z.number().int().positive(),
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
const draftSchema = z
  .object({ savedAt: z.number(), requestId: z.uuid(), value: draftValue })
  .strict();
const lifetime = 12 * 60 * 60 * 1000;
export function WorkoutEditorPage({
  userId,
  ownerId,
  date,
  returnDate,
  plan,
  workoutId,
  copying,
  returnToView = false,
}: {
  userId: string;
  ownerId: string;
  date: string;
  returnDate: string;
  plan?: WorkoutPlan;
  workoutId?: string;
  copying: boolean;
  returnToView?: boolean;
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
  const dirty = useRef(false);
  const persisted = useRef(false);
  const [stored, setStored] = useState(false);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    void fetch(`/api/workouts?ownerId=${encodeURIComponent(ownerId)}`, {
      cache: 'no-store',
    })
      .then((response) => {
        if (!response.ok) throw new Error(m.noAccess);
        if (!alive) return;
        requestId.current = crypto.randomUUID();
        try {
          for (const item of Object.keys(sessionStorage)) {
            if (!item.startsWith('workout-draft:')) continue;
            const raw = sessionStorage.getItem(item);
            const data =
              raw && raw.length <= 256_000
                ? draftSchema.safeParse(JSON.parse(raw))
                : null;
            if (
              !item.startsWith(`workout-draft:${identity}:`) ||
              !data?.success ||
              data.data.savedAt > Date.now() ||
              Date.now() - data.data.savedAt >= lifetime
            )
              sessionStorage.removeItem(item);
          }
          const stored = sessionStorage.getItem(key);
          if (stored && stored.length <= 256_000) {
            const parsed = draftSchema.safeParse(JSON.parse(stored));
            if (
              parsed.success &&
              Date.now() >= parsed.data.savedAt &&
              Date.now() - parsed.data.savedAt < lifetime
            ) {
              setDraft(parsed.data.value);
              setStored(true);
              persisted.current = true;
              requestId.current = parsed.data.requestId;
              dirty.current = true;
            } else sessionStorage.removeItem(key);
          }
        } catch {
          /* Storage can be disabled; editing remains available. */
        }
        setReady(true);
      })
      .catch(() => {
        if (!alive) return;
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* Storage unavailable. */
        }
        setError(m.noAccess);
      });
    const unsubscribe = subscribeOfflineBlocked(() => {
      dirty.current = false;
      try {
        for (const item of Object.keys(sessionStorage))
          if (item.startsWith('workout-draft:'))
            sessionStorage.removeItem(item);
      } catch {
        /* Storage unavailable. */
      }
      setStored(false);
      persisted.current = false;
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current && !persisted.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted.current = false;
      alive = false;
      unsubscribe();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [key, identity, ownerId]);
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
    try {
      const serialized = JSON.stringify({
        savedAt: Date.now(),
        requestId: requestId.current,
        value,
      });
      if (serialized.length > 256_000) {
        sessionStorage.removeItem(key);
        setStored(false);
        persisted.current = false;
        return;
      }
      const others = Object.keys(sessionStorage).filter(
        (item) => item.startsWith('workout-draft:') && item !== key,
      );
      const oldest = others.sort(
        (a, b) =>
          JSON.parse(sessionStorage.getItem(a)!).savedAt -
          JSON.parse(sessionStorage.getItem(b)!).savedAt,
      );
      while (oldest.length >= 8) sessionStorage.removeItem(oldest.shift()!);
      sessionStorage.setItem(key, serialized);
      setStored(true);
      persisted.current = true;
    } catch {
      setStored(false);
      persisted.current = false;
    }
  };
  const save = async (value: WorkoutPlanInput) => {
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
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : m.error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Stack w="100%">
      <Group justify="space-between">
        <Title order={1}>
          {plan && !copying ? m.editWorkout : m.newWorkout}
        </Title>
        <Button
          mih={44}
          variant="subtle"
          disabled={busy}
          onClick={() =>
            router.push(
              returnToView && plan && workoutId
                ? `/workouts/plans/${plan.id}/workouts/${workoutId}?date=${returnDate}`
                : `/workouts?date=${returnDate}`,
            )
          }
        >
          {m.back}
        </Button>
      </Group>
      {error && (
        <Alert role="alert" color="red">
          {error}
        </Alert>
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
        onClose={() => setCancel(false)}
        title={m.discardQuestion}
        closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      >
        <Group>
          <Button mih={44} variant="default" onClick={() => setCancel(false)}>
            {m.keepEditing}
          </Button>
          <Button mih={44} color="red" onClick={() => leave()}>
            {m.discard}
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
