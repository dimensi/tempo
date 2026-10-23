'use client';
import { writeMessages as m } from '@/config/offline-write-messages';
import {
  measurementInputSchema,
  measurementMetrics,
} from '@/contracts/measurements';
import type { WritePayload } from '@/contracts/offline-write';
import { workoutInputSchema } from '@/contracts/workouts';
import { subscribeSessionReset } from '@/lib/offline-device';
import {
  readDeviceWrites,
  resolveDeviceWrite,
  saveDeviceWrite,
  syncDeviceWrites,
} from '@/lib/offline-write-client';
import { emptyWriteState, type WriteState } from '@/lib/offline-write-queue';
import { useViewState } from '@/lib/use-view-state';
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useEffect, useState } from 'react';
const exercise = () => ({
  id: crypto.randomUUID(),
  name: '',
  sets: [{ reps: '', weightKg: '' }],
});
export function OfflineWrites({
  kind,
  pendingOnly = false,
}: {
  kind: WritePayload['kind'];
  pendingOnly?: boolean;
}) {
  const [online, setOnline] = useState(true);
  const [state, setState] = useState<WriteState>(emptyWriteState);
  const [editing, setEditing] = useViewState<{
    id?: string;
    base?: string;
  } | null>(`queue:${kind}:editing`, null);
  const [date, setDate] = useViewState(`queue:${kind}:date`, '');
  const [title, setTitle] = useViewState(`queue:${kind}:title`, '');
  const [note, setNote] = useViewState(`queue:${kind}:note`, '');
  const [exercises, setExercises] = useViewState<ReturnType<typeof exercise>[]>(
    `queue:${kind}:exercises`,
    [],
  );
  const [values, setValues] = useViewState<Record<string, string>>(
    `queue:${kind}:values`,
    {},
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void readDeviceWrites()
        .then((value) => {
          if (active) setState(value);
        })
        .catch(() => {
          if (active) setState(emptyWriteState());
        });
    };
    const blocked = subscribeSessionReset(() => {
      setState(emptyWriteState());
      setEditing(null);
      setExercises([]);
      setValues({});
      setTitle('');
      setNote('');
    });
    const connectivity = () => setOnline(navigator.onLine);
    connectivity();
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    refresh();
    window.addEventListener('offline-writes-changed', refresh);
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      blocked();
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      clearInterval(timer);
      window.removeEventListener('offline-writes-changed', refresh);
    };
  }, [setEditing, setExercises, setNote, setTitle, setValues]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (editing) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing]);
  function start(id?: string) {
    const record = state.records.find((item) => item.id === id);
    setEditing(id ? { id, base: record?.version } : {});
    setError(undefined);
    setDate(
      record?.payload.kind === 'measurement'
        ? record.payload.data.measuredAt
        : (record?.payload.data.date ??
            `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`),
    );
    setNote(record?.payload.data.note ?? '');
    setTitle(
      record?.payload.kind === 'workout' ? record.payload.data.title : '',
    );
    setExercises(
      record?.payload.kind === 'workout'
        ? record.payload.data.exercises.map((item) => ({
            id: item.id ?? crypto.randomUUID(),
            name: item.name,
            sets: item.sets.map((set) => ({
              reps: String(set.reps ?? ''),
              weightKg: String(set.weightKg ?? ''),
            })),
          }))
        : [exercise()],
    );
    setValues(
      record?.payload.kind === 'measurement'
        ? Object.fromEntries(
            record.payload.data.values.map((item) => [item.metric, item.value]),
          )
        : {},
    );
  }
  async function save() {
    const previous = state.records.find((record) => record.id === editing?.id);
    let payload: WritePayload;
    if (kind === 'measurement') {
      const parsed = measurementInputSchema.safeParse({
        measuredAt: date,
        note: note || null,
        values: measurementMetrics
          .filter((metric) => values[metric]?.trim())
          .map((metric) => ({
            metric,
            value: values[metric]!.replace(',', '.'),
            unit: metric === 'weight' ? 'kg' : 'cm',
          })),
      });
      if (!parsed.success) {
        setError(m.validation);
        return;
      }
      payload = { kind, data: parsed.data };
    } else {
      const parsed = workoutInputSchema.safeParse({
        date,
        title,
        note,
        status:
          previous?.payload.kind === 'workout'
            ? previous.payload.data.status
            : 'planned',
        exercises: exercises.map((item) => ({
          ...(previous?.payload.kind === 'workout'
            ? previous.payload.data.exercises.find((ex) => ex.id === item.id)
            : {}),
          ...item,
          sets: item.sets.map((set) => ({
            reps: set.reps ? Number(set.reps) : null,
            weightKg: set.weightKg
              ? Number(set.weightKg.replace(',', '.'))
              : null,
          })),
        })),
      });
      if (
        !parsed.success ||
        exercises.some((item) => item.sets.some((set) => !set.reps))
      ) {
        setError(m.validation);
        return;
      }
      payload = { kind, data: parsed.data };
    }
    setBusy(true);
    setError(undefined);
    try {
      await saveDeviceWrite(payload, editing?.id, editing?.base);
      setEditing(null);
      setState(await readDeviceWrites());
      void syncDeviceWrites().catch(() => {});
    } catch {
      setError(m.error);
    } finally {
      setBusy(false);
    }
  }
  const needsAttention = (item: WriteState['operations'][number]) =>
    item.status !== 'synced' &&
    (!online ||
      item.status === 'review' ||
      (item.status === 'local' && item.attempts > 0) ||
      (item.status === 'sending' && item.attempts > 1));
  if (
    !state.partition ||
    (pendingOnly &&
      !editing &&
      !state.operations.some(
        (item) => item.operation.payload.kind === kind && needsAttention(item),
      )) ||
    (online &&
      !editing &&
      !state.operations.some((item) => item.operation.payload.kind === kind))
  )
    return null;
  return (
    <Paper withBorder p="md" data-testid="device-write-queue">
      <Stack>
        <Title order={2} size="h3">
          {pendingOnly ? m.pendingTitle : m.title}
        </Title>
        <Text size="sm">{pendingOnly ? m.pendingHint : m.hint}</Text>
        {!online && !pendingOnly && (
          <Button mih={44} onClick={() => start()} disabled={busy || !!editing}>
            {kind === 'workout' ? m.newWorkout : m.newMeasurement}
          </Button>
        )}
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {editing && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Stack>
              <TextInput
                type="date"
                required
                label={m.date}
                value={date}
                onChange={(event) => setDate(event.currentTarget.value)}
                disabled={busy}
              />
              {kind === 'measurement' ? (
                measurementMetrics.map((metric) => (
                  <TextInput
                    key={metric}
                    label={m.metrics[metric]}
                    inputMode="decimal"
                    value={values[metric] ?? ''}
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setValues((old) => ({ ...old, [metric]: value }));
                    }}
                  />
                ))
              ) : (
                <>
                  <TextInput
                    label={m.titleField}
                    value={title}
                    maxLength={160}
                    disabled={busy}
                    onChange={(event) => setTitle(event.currentTarget.value)}
                  />
                  {exercises.map((item, index) => (
                    <Stack key={item.id}>
                      <TextInput
                        label={m.exercise}
                        required
                        value={item.name}
                        disabled={busy}
                        onChange={(event) => {
                          const name = event.currentTarget.value;
                          setExercises((old) =>
                            old.map((value, i) =>
                              i === index ? { ...value, name } : value,
                            ),
                          );
                        }}
                      />
                      {item.sets.map((set, si) => (
                        <Group key={si} grow>
                          {(['weightKg', 'reps'] as const).map((field) => (
                            <TextInput
                              key={field}
                              label={field === 'reps' ? m.reps : m.weight}
                              inputMode="decimal"
                              value={set[field]}
                              disabled={busy}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setExercises((old) =>
                                  old.map((ex, i) =>
                                    i === index
                                      ? {
                                          ...ex,
                                          sets: ex.sets.map((s, j) =>
                                            j === si
                                              ? { ...s, [field]: value }
                                              : s,
                                          ),
                                        }
                                      : ex,
                                  ),
                                );
                              }}
                            />
                          ))}
                        </Group>
                      ))}
                      <Button
                        variant="subtle"
                        mih={44}
                        disabled={busy || item.sets.length >= 50}
                        onClick={() =>
                          setExercises((old) =>
                            old.map((ex, i) =>
                              i === index
                                ? {
                                    ...ex,
                                    sets: [
                                      ...ex.sets,
                                      { reps: '', weightKg: '' },
                                    ],
                                  }
                                : ex,
                            ),
                          )
                        }
                      >
                        {m.addSet}
                      </Button>
                    </Stack>
                  ))}
                  <Button
                    variant="subtle"
                    mih={44}
                    disabled={busy || !!editing.id || exercises.length >= 50}
                    onClick={() => setExercises((old) => [...old, exercise()])}
                  >
                    {m.addExercise}
                  </Button>
                </>
              )}
              <Textarea
                label={m.note}
                value={note}
                disabled={busy}
                onChange={(event) => setNote(event.currentTarget.value)}
              />
              <Group>
                <Button type="submit" mih={44} loading={busy}>
                  {m.save}
                </Button>
                <Button
                  variant="default"
                  mih={44}
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  {m.cancel}
                </Button>
              </Group>
            </Stack>
          </form>
        )}
        {state.records
          .filter(
            (record) =>
              record.payload.kind === kind &&
              (pendingOnly
                ? state.operations.some(
                    (item) =>
                      item.operation.recordId === record.id &&
                      needsAttention(item),
                  )
                : !online ||
                  state.operations.some(
                    (item) => item.operation.recordId === record.id,
                  )),
          )
          .map((record) => {
            const operations = state.operations.filter(
              (item) => item.operation.recordId === record.id,
            );
            const uncertain = operations.some(
              (item) => item.status === 'review' && item.reason !== 'conflict',
            );
            const status =
              operations.find((item) => item.status === 'review')?.status ??
              operations.find((item) => item.status === 'sending')?.status ??
              operations.find((item) => item.status === 'local')?.status ??
              'synced';
            return (
              <Paper key={record.id} withBorder p="sm">
                <Stack gap="xs">
                  <Text>
                    {record.payload.kind === 'measurement'
                      ? record.payload.data.measuredAt
                      : `${record.payload.data.date} ${record.payload.data.title}`}
                  </Text>
                  <Text size="sm">
                    {record.payload.kind === 'measurement'
                      ? record.payload.data.values
                          .map((v) => `${m.metrics[v.metric]}: ${v.value}`)
                          .join('; ')
                      : record.payload.data.exercises
                          .map(
                            (e) =>
                              `${e.name}: ${e.sets.map((s) => `${s.weightKg ?? '—'} × ${s.reps ?? '—'}`).join(', ')}`,
                          )
                          .join('; ')}
                  </Text>
                  <Text role="status">{m[status]}</Text>
                  {status === 'review' ? (
                    <>
                      <Alert>{m.conflict}</Alert>
                      <Group>
                        {(uncertain ? [true] : [false, true]).map((keep) => (
                          <Button
                            key={String(keep)}
                            mih={44}
                            variant="default"
                            onClick={() => {
                              void resolveDeviceWrite(record.id, keep)
                                .then(() => readDeviceWrites())
                                .then(setState)
                                .then(() => syncDeviceWrites())
                                .catch(() => setError(m.error));
                            }}
                          >
                            {uncertain
                              ? m.recheck
                              : keep
                                ? m.keepLocal
                                : m.keepServer}
                          </Button>
                        ))}
                      </Group>
                    </>
                  ) : (
                    <Button
                      mih={44}
                      variant="subtle"
                      disabled={busy || !!editing}
                      onClick={() => start(record.id)}
                    >
                      {m.edit}
                    </Button>
                  )}
                </Stack>
              </Paper>
            );
          })}
        {!pendingOnly && (
          <Text size="xs" c="dimmed">
            {m.retention}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
