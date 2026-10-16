'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ReadLink as Link } from '@/components/shared/read-link';
import { useReadRouter as useRouter } from '@/lib/workspace-navigation';
import {
  ActionIcon,
  Badge,
  Tooltip,
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconPencil,
  IconCopy,
  IconTrash,
  IconClipboardCheck,
  IconCalendar,
} from '@tabler/icons-react';
import { z } from 'zod';
import {
  type WorkoutPlan,
  type PlannedWorkout,
  type WorkoutSession,
} from '@/contracts/workouts';
import type { TransformMateSyncItem } from '@/contracts/transformmate';
import type { TransformMateNativeItem } from '@/contracts/transformmate-native';
import { workoutTitle } from '@/lib/workout-title';
import { WorkoutVideos } from './workout-videos';
import { ExerciseTable } from './exercise-table';
import { WorkoutReadContent } from './read-content';
import { WorkoutSync } from './transformmate-sync';
import { workoutMessages as m } from './messages';
import classes from './workout-ui.module.css';

export type WorkoutDetail =
  | {
      kind: 'plan';
      plan: WorkoutPlan;
      workout: PlannedWorkout;
      sync: TransformMateSyncItem | null;
      sessions: WorkoutSession[];
    }
  | { kind: 'session'; session: WorkoutSession }
  | { kind: 'native'; item: TransformMateNativeItem }
  | { kind: 'link'; item: TransformMateSyncItem };
export function WorkoutDetailView({
  ownerId,
  canLog,
  date,
  detail,
  renderComments,
}: {
  ownerId: string;
  canLog: boolean;
  date: string;
  detail: WorkoutDetail;
  renderComments?: (id: string) => ReactNode;
}) {
  const router = useRouter();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [copyDate, setCopyDate] = useState('');
  const [copying, setCopying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = detail.kind === 'plan' ? detail.plan : null;
  const workout = detail.kind === 'plan' ? detail.workout : null;
  const session = detail.kind === 'session' ? detail.session : null;
  const title = workout
    ? workoutTitle(workout.title, workout.date)
    : session
      ? workoutTitle(session.title, session.date)
      : detail.kind === 'native'
        ? detail.item.title
        : detail.kind === 'link'
          ? (detail.item.actual?.title ??
            workoutTitle(
              detail.item.planSnapshot.workout.title,
              detail.item.planSnapshot.workout.date,
            ))
          : '';
  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workouts${path}?ownerId=${encodeURIComponent(ownerId)}`,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (response.status === 401 || response.status === 403) {
        if (mounted.current) setDenied(true);
        return;
      }
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? m.conflict
            : response.status === 403 || response.status === 401
              ? m.noAccess
              : m.error,
        );
      if (method === 'DELETE' && mounted.current)
        router.push(`/workouts?date=${date}`);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : m.error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  if (denied) return <Alert color="red">{m.noAccess}</Alert>;
  return (
    <Stack
      className={classes.content}
      data-testid={
        plan ? `plan-${plan.id}` : session ? `session-${session.id}` : undefined
      }
      gap="lg"
      style={{ minWidth: 0 }}
    >
      <Group justify="space-between">
        <Title order={1} size="h2">
          {title}
        </Title>
        <Button
          component={Link}
          href={`/workouts?date=${date}`}
          variant="subtle"
          size="compact-sm"
          mih={44}
          leftSection={<IconArrowLeft size={16} />}
        >
          {m.back}
        </Button>
      </Group>
      <Group gap="xs">
        {(plan || session) && (
          <Badge variant="outline" color="gray" c="dimmed">
            {m.localSource}
          </Badge>
        )}
        {workout && plan && (
          <Tooltip label={m.editWorkout}>
            <ActionIcon
              component={Link}
              href={`/workouts/plans/${plan.id}/edit?workout=${workout.id}&date=${date}&from=view`}
              variant={canLog ? 'subtle' : 'filled'}
              size={44}
              aria-label={m.editWorkout}
            >
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
        )}
        {canLog && (workout || session) && (
          <Button
            size="compact-sm"
            mih={44}
            leftSection={<IconClipboardCheck size={16} />}
            aria-label={session ? m.editActual : m.record}
            component={Link}
            href={
              session
                ? `/workouts/sessions/${session.id}/edit?date=${date}&from=view`
                : `/workouts/plans/${plan!.id}/workouts/${workout!.id}/results?date=${date}&from=view`
            }
          >
            {session ? m.editActual : m.record}
          </Button>
        )}
        {plan && workout && (
          <Tooltip label={m.copy}>
            <ActionIcon
              variant="subtle"
              size={44}
              aria-label={m.copy}
              onClick={() => {
                setCopyDate(workout.date);
                setCopying(true);
              }}
            >
              <IconCopy size={16} />
            </ActionIcon>
          </Tooltip>
        )}
        {plan && plan.workouts.length > 1 && (
          <Tooltip label={m.editPlan}>
            <ActionIcon
              component={Link}
              href={`/workouts/plans/${plan.id}/edit?date=${date}`}
              variant="subtle"
              size={44}
              aria-label={m.editPlan}
            >
              <IconCalendar size={16} />
            </ActionIcon>
          </Tooltip>
        )}
        {(plan || (session && canLog)) && (
          <Button
            color="red"
            variant="subtle"
            size="compact-sm"
            mih={44}
            leftSection={<IconTrash size={16} />}
            aria-label={plan ? m.removePlan : m.removeActual}
            onClick={() => setDeleting(true)}
          >
            {m.deleteShort}
          </Button>
        )}
      </Group>
      {detail.kind === 'plan' && (
        <>
          <WorkoutReadContent
            kind="plan"
            sync={detail.sync ?? undefined}
            ownerId={ownerId}
            description={detail.plan.description}
            exercises={detail.workout.exercises}
            sessions={detail.sessions.map((result) => ({
              key: result.id,
              exercises: result.exercises,
              note: result.note,
            }))}
            comments={renderComments}
          />
          <WorkoutSync item={detail.sync ?? undefined} />
        </>
      )}
      {detail.kind === 'session' && (
        <WorkoutReadContent
          kind="session"
          ownerId={ownerId}
          status={detail.session.status}
          exercises={detail.session.exercises}
          snapshot={
            detail.session.planSnapshot
              ? {
                  title: detail.session.planSnapshot.planTitle,
                  exercises: detail.session.planSnapshot.workout.exercises,
                }
              : null
          }
          note={detail.session.note}
          comments={renderComments?.(detail.session.id)}
        />
      )}
      {session && (
        <WorkoutVideos ownerId={ownerId} session={session} canUpload={canLog} />
      )}
      {detail.kind === 'native' && (
        <WorkoutReadContent
          kind="native"
          ownerId={ownerId}
          item={detail.item}
        />
      )}
      {detail.kind === 'link' && (
        <>
          <Text>{m.publishedSnapshot}</Text>
          <ExerciseTable
            ownerId={ownerId}
            exercises={
              (detail.item.publishedSnapshot ?? detail.item.planSnapshot)
                .workout.exercises
            }
            sync={detail.item}
          />
          <WorkoutSync item={detail.item} />
        </>
      )}
      <Modal
        opened={copying}
        onClose={() => setCopying(false)}
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
            disabled={!z.iso.date().safeParse(copyDate).success}
            onClick={() => {
              if (plan && workout)
                router.push(
                  `/workouts/new?copy=${plan.id}&workout=${workout.id}&date=${copyDate}&returnDate=${date}`,
                );
            }}
          >
            {m.copy}
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={deleting}
        onClose={() => {
          if (!busy) setDeleting(false);
        }}
        title={m.confirmDelete}
        closeOnEscape={!busy}
        closeOnClickOutside={!busy}
        withCloseButton={!busy}
      >
        <Stack>
          <Text>{m.confirmText}</Text>
          {error && <Alert color="red">{error}</Alert>}
          <Group grow>
            <Button
              variant="default"
              disabled={busy}
              mih={44}
              onClick={() => setDeleting(false)}
            >
              {m.cancel}
            </Button>
            <Button
              color="red"
              loading={busy}
              mih={44}
              onClick={() => {
                if (plan)
                  void mutate(`/plans/${plan.id}`, 'DELETE', {
                    revision: plan.revision,
                  });
                else if (session)
                  void mutate(`/sessions/${session.id}`, 'DELETE', {
                    revision: session.revision,
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
