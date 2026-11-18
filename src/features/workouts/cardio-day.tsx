'use client';
import { useRef, useState } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconDots } from '@tabler/icons-react';
import {
  cardioCommandSchema,
  type CardioCommand,
  type CardioDay,
  type CardioWorkout,
} from '@/contracts/cardio-workouts';
import type { Workout } from '@/contracts/workouts';
import { apiFetch } from '@/lib/api-client';
import { cardioMetrics, standaloneCardio } from '@/lib/cardio-workouts';
import { workoutTitle } from '@/lib/workout-title';
import { cardioMessages as m } from './cardio-messages';
import styles from './cardio-day.module.css';

const numberFormat = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
});
const knownTypes = new Map(Object.entries(m.types));
const typeTitle = (type: string) => knownTypes.get(type.toLowerCase()) ?? type;
type Editing =
  | { kind: 'new' }
  | { kind: 'manual' | 'imported' | 'link'; row: CardioWorkout };

function CardioEditor({
  edit,
  date,
  manual,
  targets,
  ownerId,
  online,
  close,
  refreshed,
}: {
  edit: Editing;
  date: string;
  manual?: CardioWorkout;
  targets: { value: string; label: string }[];
  ownerId: string;
  online: boolean;
  close: () => void;
  refreshed: () => Promise<unknown>;
}) {
  const row = edit.kind === 'new' ? undefined : edit.row;
  const values = row ? cardioMetrics(row, manual) : null;
  const [type, setType] = useState(values?.type ?? '');
  const [time, setTime] = useState(values?.time ?? '');
  const [duration, setDuration] = useState<number | string>(
    values?.durationSeconds != null ? values.durationSeconds / 60 : '',
  );
  const initialDistance =
    values?.distanceMeters != null ? values.distanceMeters / 1000 : '';
  const [distance, setDistance] = useState<number | string>(initialDistance);
  const [energy, setEnergy] = useState<number | string>(
    values?.energyKcal ?? '',
  );
  const [equipment, setEquipment] = useState(values?.equipment ?? '');
  const [note, setNote] = useState(values?.note ?? '');
  const [target, setTarget] = useState<string | null>(row?.link?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receipt = useRef<{ key: string; payload: string } | null>(null);
  const isManual = edit.kind === 'new' || edit.kind === 'manual';
  const asNumber = (value: number | string) =>
    value === '' ? null : Number(value);
  const meters = asNumber(distance) === null ? null : Number(distance) * 1000;
  const submitting = useRef(false);
  async function save(unlink = false) {
    if (submitting.current || !online) return;
    const data = {
      date,
      type,
      time: time || null,
      durationSeconds: Number(duration) * 60,
      distanceMeters: meters,
      energyKcal: asNumber(energy),
      equipment: equipment || null,
      note,
    };
    const payload =
      row == null
        ? { kind: 'create', input: { data } }
        : {
            kind: 'update',
            input: {
              id: row.id,
              revision: row.revision,
              ...(edit.kind === 'manual'
                ? { kind: 'manual', data }
                : edit.kind === 'imported'
                  ? {
                      kind: 'imported',
                      overrides: {
                        ...(asNumber(distance) !== asNumber(initialDistance)
                          ? { distanceMeters: meters }
                          : {}),
                        ...(values?.equipment !== data.equipment
                          ? { equipment: data.equipment }
                          : {}),
                        ...(values?.note !== note ? { note } : {}),
                      },
                    }
                  : {
                      kind: 'link',
                      target: unlink
                        ? null
                        : {
                            kind: row.imported?.strength
                              ? 'strength'
                              : 'cardio',
                            id: target,
                          },
                    }),
            },
          };
    const fingerprint = JSON.stringify(payload);
    if (receipt.current?.payload !== fingerprint)
      receipt.current = { key: crypto.randomUUID(), payload: fingerprint };
    const command = cardioCommandSchema.safeParse({
      ...payload,
      input: { ...payload.input, requestId: receipt.current.key },
    });
    if (!command.success) {
      setError(m.validation);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await saveCardioRequest(ownerId, command.data);
      if (response.status === 409) {
        setError(m.conflict);
        await refreshed();
        return;
      }
      if (!response.ok) throw new Error(m.saveFailed);
      await refreshed();
      close();
    } catch {
      setError(m.saveFailed);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      opened
      onClose={close}
      title={
        edit.kind === 'new' ? m.add : edit.kind === 'link' ? m.link : m.edit
      }
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      withCloseButton={!busy}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Stack gap="sm">
          {edit.kind === 'link' ? (
            <Select
              label={m.target}
              data={targets}
              value={target}
              onChange={setTarget}
              allowDeselect={false}
            />
          ) : (
            <>
              {isManual && (
                <>
                  <TextInput
                    label={m.type}
                    value={type}
                    onChange={(event) => setType(event.currentTarget.value)}
                    required
                    maxLength={100}
                  />
                  <div className={styles.fields}>
                    <NumberInput
                      label={m.duration}
                      value={duration}
                      onChange={setDuration}
                      required
                      min={0.01}
                      max={10080}
                    />
                    <TextInput
                      label={m.time}
                      type="time"
                      value={time}
                      onChange={(event) => setTime(event.currentTarget.value)}
                    />
                  </div>
                </>
              )}
              <div className={styles.fields}>
                <NumberInput
                  label={m.distance}
                  value={distance}
                  onChange={setDistance}
                  min={0}
                  max={1000}
                />
                {isManual && (
                  <NumberInput
                    label={m.energy}
                    value={energy}
                    onChange={setEnergy}
                    min={0}
                    max={100000}
                  />
                )}
              </div>
              <TextInput
                label={m.equipment}
                value={equipment}
                onChange={(event) => setEquipment(event.currentTarget.value)}
                maxLength={120}
              />
              <Textarea
                label={m.note}
                value={note}
                onChange={(event) => setNote(event.currentTarget.value)}
                maxLength={4000}
                autosize
                minRows={2}
              />
            </>
          )}
          {!online && (
            <Text size="sm" c="dimmed">
              {m.saveOffline}
            </Text>
          )}
          {error && (
            <Text role="alert" c="red" size="sm">
              {error}
            </Text>
          )}
          <Group justify="flex-end" gap="xs">
            {edit.kind === 'link' && row?.link && (
              <Button
                variant="subtle"
                onClick={() => void save(true)}
                disabled={busy || !online}
              >
                {m.unlink}
              </Button>
            )}
            <Button variant="default" onClick={close} disabled={busy}>
              {m.cancel}
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={!online || (edit.kind === 'link' && !target)}
            >
              {m.save}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

async function saveCardioRequest(ownerId: string, command: CardioCommand) {
  return apiFetch('/api/workouts/cardio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId, action: 'save', command }),
  });
}

export async function refreshCardioRequest(ownerId: string, date: string) {
  const response = await apiFetch('/api/workouts/cardio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId, action: 'refresh', date }),
  });
  return response.ok && (await response.json()).data?.refreshed === true;
}

export function CardioDayView({
  data,
  date,
  ownerId,
  canEdit,
  online,
  create,
  onCloseCreate,
  refreshed,
  strength,
  activeStrengthId,
}: {
  data?: CardioDay;
  date: string;
  ownerId: string;
  canEdit: boolean;
  online: boolean;
  create: boolean;
  onCloseCreate: () => void;
  refreshed: () => Promise<unknown>;
  strength: Workout[];
  activeStrengthId?: string;
}) {
  const [editing, setEditing] = useState<Exclude<
    Editing,
    { kind: 'new' }
  > | null>(null);
  const edit = create ? { kind: 'new' as const } : editing;
  const rows = data?.workouts ?? [];
  const linkedTargets = new Set(
    rows.flatMap((row) => (row.link ? [row.link.id] : [])),
  );
  const manualFor = (row: CardioWorkout) =>
    row.link?.kind === 'cardio'
      ? rows.find((candidate) => candidate.id === row.link!.id)
      : undefined;
  const orderTime = (row: CardioWorkout) =>
    row.imported?.time
      ? row.imported.providerDate.slice(11, 19)
      : (cardioMetrics(row, manualFor(row)).time ?? '99:99');
  const ordered = standaloneCardio(rows).sort((a, b) =>
    orderTime(a).localeCompare(orderTime(b)),
  );
  const linkedStrength = rows.find(
    (row) => row.link?.kind === 'strength' && row.link.id === activeStrengthId,
  );
  const linkRow = editing?.kind === 'link' ? editing.row : undefined;
  const targets = linkRow?.imported?.strength
    ? strength
        .filter(
          (item) =>
            item.status === 'completed' &&
            (!linkedTargets.has(item.id) || linkRow.link?.id === item.id),
        )
        .map((item) => ({
          value: item.id,
          label: workoutTitle(item.title, item.date),
        }))
    : rows
        .filter(
          (item) =>
            item.manual &&
            (!linkedTargets.has(item.id) || linkRow?.link?.id === item.id),
        )
        .map((item) => ({
          value: item.id,
          label: [
            item.manual!.time,
            typeTitle(item.manual!.type),
            numberFormat.format(item.manual!.durationSeconds / 60) +
              ' ' +
              m.minute,
          ]
            .filter(Boolean)
            .join(' · '),
        }));
  const entry = (row: CardioWorkout, watch = false) => {
    const manual = manualFor(row);
    const {
      type,
      time,
      durationSeconds,
      distanceMeters,
      energyKcal,
      equipment,
      note,
    } = cardioMetrics(row, manual);
    const metrics = [
      durationSeconds !== null
        ? numberFormat.format(durationSeconds / 60) + ' ' + m.minute
        : null,
      distanceMeters && distanceMeters > 0
        ? numberFormat.format(distanceMeters / 1000) + ' ' + m.km
        : null,
      energyKcal !== null
        ? numberFormat.format(energyKcal) + ' ' + m.kcal
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const source =
      row.imported?.gateway === 'apple_health'
        ? m.appleHealth
        : row.imported
          ? m.yazio
          : m.manual;
    const canLink =
      row.link ||
      (row.imported?.strength
        ? strength.some(
            (item) =>
              item.status === 'completed' && !linkedTargets.has(item.id),
          )
        : rows.some((item) => item.manual && !linkedTargets.has(item.id)));
    return (
      <div key={row.id} className={styles.row}>
        <Text size="sm" className={styles.clock} c="dimmed">
          {time}
        </Text>
        <Stack gap={3} className={styles.rowBody}>
          <Text fw={600}>{watch ? m.watchMetrics : typeTitle(type)}</Text>
          {metrics && (
            <Text size="sm" className={styles.metrics}>
              {metrics}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {source}
            {manual ? ' · ' + m.linkedManual : ''}
            {equipment ? ' · ' + equipment : ''}
          </Text>
          {note && (
            <Text size="sm" className={styles.note}>
              {note}
            </Text>
          )}
        </Stack>
        {canEdit && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                size={44}
                aria-label={m.actions + ' · ' + typeTitle(type)}
              >
                <IconDots size={19} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                onClick={() =>
                  setEditing({
                    kind: row.imported ? 'imported' : 'manual',
                    row,
                  })
                }
              >
                {m.edit}
              </Menu.Item>
              {manual && (
                <Menu.Item
                  onClick={() => setEditing({ kind: 'manual', row: manual })}
                >
                  {m.editManual}
                </Menu.Item>
              )}
              {row.imported && canLink && (
                <Menu.Item onClick={() => setEditing({ kind: 'link', row })}>
                  {row.link ? m.unlink : m.link}
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        )}
      </div>
    );
  };
  const coverage = data?.coverage;
  const coverageNote = coverage?.failedAt
    ? coverage.fetchedAt
      ? m.importStale
      : m.refreshFailed
    : coverage && !coverage.fetchedAt
      ? m.notImported
      : coverage && !rows.some((row) => row.imported)
        ? m.importedEmpty
        : null;
  return (
    <>
      {linkedStrength && (
        <Paper withBorder radius="md" className={styles.list}>
          {entry(linkedStrength, true)}
        </Paper>
      )}
      {ordered.length > 0 && (
        <Stack gap="xs">
          <Title order={2} size="h4">
            {m.section}
          </Title>
          <Paper withBorder radius="md" className={styles.list}>
            {ordered.map((row) => entry(row))}
          </Paper>
        </Stack>
      )}
      {coverageNote && (
        <Text size="xs" c="dimmed" role="status">
          {coverageNote}
        </Text>
      )}
      {canEdit && edit && (
        <CardioEditor
          edit={edit}
          date={date}
          ownerId={ownerId}
          online={online}
          targets={targets}
          manual={edit.kind === 'new' ? undefined : manualFor(edit.row)}
          close={() => {
            setEditing(null);
            onCloseCreate();
          }}
          refreshed={refreshed}
        />
      )}
    </>
  );
}
