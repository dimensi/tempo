'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Group,
  Modal,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import type {
  PlannedWorkout,
  WorkoutSession,
  WorkoutSessionInput,
} from '@/contracts/workouts';
import { workoutSessionSchema } from '@/contracts/workouts';
import { subscribeOfflineBlocked } from '@/lib/offline-device';
import { workoutTitle } from '@/lib/workout-title';
import {
  clearWorkoutDraft,
  clearWorkoutDrafts,
  readWorkoutDraft,
  storeWorkoutDraft,
} from './draft-storage';
import {
  emptyResultDraft,
  resultDraftSchema,
  type ResultDraft,
} from './result-draft';
import { ResultForm } from './result-form';
import { WorkoutCreateChoice } from './create-choice';
import { workoutMessages as m } from './messages';
import classes from './workout-ui.module.css';

export type ResultReturn =
  | { kind: 'day' }
  | { kind: 'session'; id: string }
  | { kind: 'plan'; planId: string; workoutId: string };
export function resultReturnPath(destination: ResultReturn, date: string) {
  return destination.kind === 'plan'
    ? `/workouts/plans/${destination.planId}/workouts/${destination.workoutId}?date=${date}`
    : destination.kind === 'session'
      ? `/workouts/sessions/${destination.id}?date=${date}`
      : `/workouts?date=${date}`;
}
export function WorkoutResultsPage({
  userId,
  ownerId,
  date,
  returnDate,
  destination,
  existing,
  planned,
  planId,
  planRevision,
}: {
  userId: string;
  ownerId: string;
  date: string;
  returnDate: string;
  destination: ResultReturn;
  existing?: WorkoutSession;
  planned?: PlannedWorkout;
  planId?: string;
  planRevision?: number;
}) {
  const router = useRouter();
  const identity = `${userId}:${ownerId}`;
  const resource = existing
    ? `edit:${existing.id}:${existing.revision}`
    : planned
      ? `plan:${planId}:${planned.id}:${planRevision}`
      : `new:${date}`;
  const key = `workout-draft:${identity}:session:${resource}:${returnDate}:${JSON.stringify(destination)}`;
  const [draft, setDraft] = useState<ResultDraft>(() =>
    existing
      ? {
          title: existing.title,
          date: existing.date,
          note: existing.note,
          status: existing.status,
          exercises: structuredClone(existing.exercises),
        }
      : emptyResultDraft(planned?.date ?? date, planned),
  );
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [stored, setStored] = useState(false),
    [cancel, setCancel] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const pendingPath = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false),
    dirty = useRef(false),
    persisted = useRef(false),
    requestId = useRef('');
  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    const controller = new AbortController();
    void fetch(`/api/workouts?ownerId=${encodeURIComponent(ownerId)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          clearWorkoutDraft(key);
          setReady(false);
          setStored(false);
          persisted.current = false;
          dirty.current = false;
          throw new Error(m.noAccess);
        }
        if (!response.ok) throw new Error(m.loadError);
        if (controller.signal.aborted) return;
        requestId.current = crypto.randomUUID();
        const restored = readWorkoutDraft(key, identity, resultDraftSchema);
        if (restored) {
          setDraft(restored.value);
          requestId.current = restored.requestId;
          persisted.current = true;
          dirty.current = true;
          setStored(true);
        }
        setReady(true);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
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
      // A retained route must revalidate before showing its previous fields.
      setReady(false);
      setError(null);
      mounted.current = false;
      generation.current += 1;
      controller.abort();
      unsubscribe();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [identity, key, ownerId, attempt]);
  const change = (value: ResultDraft) => {
    dirty.current = true;
    setDraft(value);
    persisted.current = storeWorkoutDraft(key, requestId.current, value);
    setStored(persisted.current);
  };
  const discard = () => {
    dirty.current = false;
    clearWorkoutDraft(key);
    if (mounted.current)
      router.push(
        pendingPath.current ?? resultReturnPath(destination, returnDate),
      );
  };
  async function save(value: WorkoutSessionInput) {
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workouts/sessions${existing ? `/${existing.id}` : ''}?ownerId=${encodeURIComponent(ownerId)}`,
        {
          method: existing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            existing
              ? { revision: existing.revision, data: value }
              : {
                  ...value,
                  ...(planId && planned
                    ? { planId, plannedWorkoutId: planned.id }
                    : {}),
                },
          ),
        },
      );
      if (!mounted.current || current !== generation.current) return;
      if (response.status === 401 || response.status === 403) {
        clearWorkoutDraft(key);
        dirty.current = false;
        if (mounted.current) {
          setReady(false);
          setStored(false);
          setError(m.noAccess);
        }
        return;
      }
      if (!response.ok)
        throw new Error(response.status === 409 ? m.conflict : m.error);
      const saved = workoutSessionSchema.parse((await response.json()).data);
      if (!mounted.current || current !== generation.current) return;
      clearWorkoutDraft(key);
      dirty.current = false;
      router.push(`/workouts/sessions/${saved.id}?date=${returnDate}`);
    } catch (cause) {
      if (mounted.current && current === generation.current)
        setError(cause instanceof Error ? cause.message : m.error);
    } finally {
      if (mounted.current && current === generation.current) setBusy(false);
    }
  }
  return (
    <Stack className={classes.content} gap="md" style={{ minWidth: 0 }}>
      <Group justify="space-between">
        <Title order={1} size="h2">
          {existing ? m.editActual : m.resultsTitle}
        </Title>
        <Button
          variant="subtle"
          size="compact-sm"
          mih={44}
          disabled={busy}
          leftSection={<IconArrowLeft size={16} />}
          onClick={() =>
            dirty.current && !persisted.current
              ? setCancel(true)
              : router.push(resultReturnPath(destination, returnDate))
          }
        >
          {m.back}
        </Button>
      </Group>
      {ready && (
        <>
          {!existing && !planned && (
            <WorkoutCreateChoice
              kind="performed"
              date={date}
              returnDate={returnDate}
              canLog
              busy={busy}
              onNavigate={(path) => {
                if (dirty.current && !persisted.current) {
                  pendingPath.current = path;
                  setCancel(true);
                } else router.push(path);
              }}
            />
          )}
          <Text fw={600}>
            {workoutTitle(draft.title, planned?.date ?? draft.date)}
          </Text>
          <ResultForm
            ownerId={ownerId}
            value={draft}
            planned={planned}
            onChange={change}
            onSave={(value) => void save(value)}
            onCancel={() => (dirty.current ? setCancel(true) : discard())}
            busy={busy}
            error={error}
          />
          {stored && (
            <Text size="sm" c="dimmed">
              {m.draftSaved}
            </Text>
          )}
        </>
      )}
      {!ready &&
        (error ? (
          <Alert color="red" role="alert">
            {error}
            {error !== m.noAccess && (
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
        ) : (
          <Skeleton h={120} aria-label={m.loading} />
        ))}
      <Modal
        opened={cancel}
        onClose={() => {
          pendingPath.current = null;
          setCancel(false);
        }}
        title={m.discardQuestion}
        closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      >
        <Group justify="flex-end">
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
          <Button mih={44} color="red" onClick={discard}>
            {m.discard}
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
