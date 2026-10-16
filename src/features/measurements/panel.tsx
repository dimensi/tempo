'use client';
import { readWorkspaceMessages } from '@/config/read-workspace';
import { offlineMessages } from '@/config/offline';
import { useReadResource } from '@/lib/use-read-resource';
import { measurementSchema } from '@/contracts/measurements';
import { z } from 'zod';
import { useReadRefresh } from '@/lib/use-read-refresh';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { LineChart } from '@mantine/charts';
import {
  measurementMetrics,
  measurementInputSchema,
  type Measurement,
  type MeasurementMetric,
} from '@/contracts/measurements';
import { measurementMessages as m } from './messages';
import { measurementChange, weightTrendChart } from './history';
import {
  measurementPrecisionIssueSchema,
  type MeasurementPrecisionIssue,
} from '@/contracts/yazio-body';
import { MeasurementPrecisionWarnings } from './precision-warnings';
import type { WeightHistory } from '@/contracts/health';
import { writeMessages } from '@/config/offline-write-messages';
import {
  saveDeviceWrite,
  synchronizeDeviceWrite,
} from '@/lib/offline-write-client';
import { formatDecimal } from '@/lib/number-display';
function responseError(status: number) {
  return status === 401
    ? m.sessionExpired
    : status === 403
      ? m.forbidden
      : status === 400
        ? m.validation
        : m.error;
}
export function MeasurementsPanel({
  ownerId,
  deviceWrites = false,
  writable,
  weightHistory,
  renderComments,
  saved,
}: {
  ownerId: string;
  writable: boolean;
  deviceWrites?: boolean;
  saved?: Measurement[];
  weightHistory: WeightHistory;
  renderComments?: (measurementId: string) => ReactNode;
}) {
  const readRefresh = useReadRefresh();
  const [issues, setIssues] = useState<MeasurementPrecisionIssue[]>([]);
  const [retrying, setRetrying] = useState<string>();
  const [loadedItems, setItems] = useState<Measurement[]>(saved ?? []);
  const items = saved ?? loadedItems;
  const [loading, setLoading] = useState(!saved);
  const [readDenied, setReadDenied] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editingOriginal, setEditingOriginal] = useState<Measurement>();
  const [editing, setEditing] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [values, setValues] = useState<
    Partial<Record<MeasurementMetric, string>>
  >({});
  const [metric, setMetric] = useState<MeasurementMetric>('weight');
  const currentEdited =
    editingOriginal && items.find((item) => item.id === editingOriginal.id);
  const content = (item: Measurement) =>
    JSON.stringify({
      measuredAt: item.measuredAt,
      note: item.note,
      values: item.values,
    });
  const conflict =
    !!editingOriginal &&
    (!currentEdited || content(currentEdited) !== content(editingOriginal));
  const url = `/api/measurements?ownerId=${encodeURIComponent(ownerId)}`;
  const readResource1 = useReadResource({
    href: saved ? undefined : url,
    parse: (value) => z.array(measurementSchema).parse(value),
  });
  const [acceptedreadResource1, setAcceptedreadResource1] =
    useState<typeof readResource1.data>();
  if (
    readResource1.data !== undefined &&
    acceptedreadResource1 !== readResource1.data
  ) {
    setAcceptedreadResource1(readResource1.data);
    setItems(readResource1.data);
    setLoading(false);
  }
  useEffect(() => {
    if (saved) return;
    let active = true;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          if (active && (r.status === 401 || r.status === 403)) {
            setItems([]);
            setIssues([]);
            setReadDenied(true);
          }
          throw new Error();
        }
        return r.json() as Promise<Measurement[]>;
      })
      .then((data) => {
        if (active) {
          setReadDenied(false);
          setItems(data);
        }
      })
      .catch(() => {
        if (active) setError(m.loadError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url, saved, readRefresh]);
  useEffect(() => {
    if (saved) return;
    let active = true;
    void fetch(`/api/measurements/sync?ownerId=${encodeURIComponent(ownerId)}`)
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          if (active) {
            setIssues([]);
            setItems([]);
            setReadDenied(true);
          }
          return;
        }
        if (response.ok) {
          const data = measurementPrecisionIssueSchema
            .array()
            .parse(await response.json());
          if (active) setIssues(data);
        }
      })
      .catch(() => {});
    if (
      !items.some((item) =>
        item.sync.some(
          (status) =>
            status.state === 'pending' || status.state === 'uncertain',
        ),
      )
    )
      return () => {
        active = false;
      };
    const timer = setInterval(() => {
      void fetch(url, { cache: 'no-store' })
        .then(async (response) => {
          if (response.status === 401 || response.status === 403) {
            if (active) {
              setItems([]);
              setIssues([]);
              setReadDenied(true);
            }
            return;
          }
          if (response.ok) {
            const data = await response.json();
            if (active) setItems(data);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ownerId, url, items, saved]);
  async function retrySync(id: string) {
    setRetrying(id);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/measurements/${id}/retry?ownerId=${encodeURIComponent(ownerId)}`,
        { method: 'POST' },
      );
      if (!response.ok) {
        setError(responseError(response.status));
        return;
      }
      const updated = (await response.json()) as Measurement;
      setItems((old) => old.map((item) => (item.id === id ? updated : item)));
    } catch {
      setError(m.error);
    } finally {
      setRetrying(undefined);
    }
  }
  function reset() {
    setEditing(undefined);
    setEditingOriginal(undefined);
    setValues({});
    setNote('');
  }
  async function save() {
    const parsed = measurementInputSchema.safeParse({
      measuredAt: date,
      note: note || null,
      values: measurementMetrics
        .filter((key) => values[key]?.trim())
        .map((key) => ({
          metric: key,
          value: values[key]!.trim().replace(',', '.'),
          unit: key === 'weight' ? 'kg' : 'cm',
        })),
    });
    if (!parsed.success) {
      setError(m.validation);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (deviceWrites) {
        let base: string | undefined;
        if (editingOriginal) {
          const normalized = measurementInputSchema.parse({
            measuredAt: editingOriginal.measuredAt,
            values: editingOriginal.values,
            note: editingOriginal.note,
          });
          base = Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(JSON.stringify(normalized)),
              ),
            ),
          )
            .map((value) => value.toString(16).padStart(2, '0'))
            .join('');
        }
        const operation = await saveDeviceWrite(
          { kind: 'measurement', data: parsed.data },
          editing,
          base,
        );
        await synchronizeDeviceWrite(operation);
        setItems((old) => [
          ...old.filter((item) => item.id !== operation.recordId),
          { ...parsed.data, id: operation.recordId, ownerId, sync: [] },
        ]);
        reset();
        return;
      }
      const r = await fetch(
        editing
          ? `/api/measurements/${editing}?ownerId=${encodeURIComponent(ownerId)}`
          : url,
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        },
      );
      if (!r.ok) {
        setError(responseError(r.status));
        return;
      }
      const item = (await r.json()) as Measurement;
      setItems((old) =>
        [...old.filter((x) => x.id !== item.id), item].sort((a, b) =>
          b.measuredAt.localeCompare(a.measuredAt),
        ),
      );
      reset();
    } catch {
      setError(deviceWrites ? writeMessages.error : m.error);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError(undefined);
    try {
      const r = await fetch(
        `/api/measurements/${id}?ownerId=${encodeURIComponent(ownerId)}`,
        { method: 'DELETE' },
      );
      if (!r.ok) {
        setError(responseError(r.status));
        return;
      }
      setItems((old) => old.filter((x) => x.id !== id));
      setDeleting(undefined);
      if (editing === id) reset();
    } catch {
      setError(m.error);
    } finally {
      setBusy(false);
    }
  }
  if (readDenied)
    return (
      <Stack data-testid="measurements-panel">
        <Title order={1}>{m.title}</Title>
        <Alert color="red" role="alert">
          {m.denied}
        </Alert>
      </Stack>
    );
  const chart =
    metric === 'weight'
      ? weightTrendChart({
          ...weightHistory,
          local: items.flatMap((item) =>
            item.values
              .filter((value) => value.metric === 'weight')
              .map((value) => ({
                measuredAt: item.measuredAt,
                value: value.value,
                unit: 'kg' as const,
                source: 'LOCAL' as const,
              })),
          ),
        })
      : [...items].reverse().flatMap((item) => {
          const v = item.values.find((v) => v.metric === metric);
          return v ? [{ date: item.measuredAt, value: Number(v.value) }] : [];
        });
  return (
    <Stack data-testid="measurements-panel">
      <Title order={1}>{m.title}</Title>
      {conflict && (
        <Alert color="orange">{offlineMessages.draftConflict}</Alert>
      )}
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {!writable && <Text>{m.readOnly}</Text>}
      {loading && <Text>{m.loading}</Text>}
      {writable && (
        <Paper withBorder p="md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Stack>
              <TextInput
                type="date"
                label={m.date}
                value={date}
                onChange={(e) => setDate(e.currentTarget.value)}
                required
              />
              <Text size="sm">{m.valueHint}</Text>
              <Text size="sm" c="dimmed">
                {m.syncHint}
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                {measurementMetrics.map((key) => (
                  <TextInput
                    key={key}
                    label={`${m.metrics[key]} (${m.units[key === 'weight' ? 'kg' : 'cm']})`}
                    inputMode="decimal"
                    value={values[key] ?? ''}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      setValues((old) => ({ ...old, [key]: value }));
                    }}
                  />
                ))}
              </SimpleGrid>
              <Textarea
                label={m.note}
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.currentTarget.value)}
              />
              <Group>
                <Button type="submit" loading={busy} mih={44}>
                  {m.save}
                </Button>
                {editing && (
                  <Button
                    variant="default"
                    onClick={reset}
                    disabled={busy}
                    mih={44}
                  >
                    {m.cancel}
                  </Button>
                )}
              </Group>
            </Stack>
          </form>
        </Paper>
      )}
      <Title order={2}>{m.trend}</Title>
      <Select
        label={m.trend}
        data={measurementMetrics.map((value) => ({
          value,
          label: m.metrics[value],
        }))}
        value={metric}
        onChange={(v) => {
          if (v) setMetric(v as MeasurementMetric);
        }}
      />
      {metric === 'weight' && (
        <Text size="sm">
          {m.localWholeHistory} {m.yazioRange}: {weightHistory.range.from} —{' '}
          {weightHistory.range.to}.
        </Text>
      )}
      {chart.length ? (
        <LineChart
          data-testid="measurement-trend-chart"
          h={260}
          data={chart}
          dataKey="date"
          withLegend={metric === 'weight'}
          connectNulls={false}
          valueFormatter={(value) =>
            `${formatDecimal(value)} ${m.units[metric === 'weight' ? 'kg' : 'cm']}`
          }
          series={
            metric === 'weight'
              ? [
                  { name: 'local', label: m.localSource, color: 'blue.6' },
                  { name: 'yazio', label: m.yazioSource, color: 'orange.6' },
                ]
              : [{ name: 'value', label: m.metrics[metric], color: 'blue.6' }]
          }
        />
      ) : (
        <Text>{m.empty}</Text>
      )}
      <MeasurementPrecisionWarnings issues={issues} />
      <Title order={2}>{m.history}</Title>
      {!loading && !items.length && <Text>{m.empty}</Text>}
      <Table.ScrollContainer minWidth={580}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{m.date}</Table.Th>
              <Table.Th>{m.title}</Table.Th>
              <Table.Th>{m.note}</Table.Th>
              {writable && <Table.Th />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td>{item.measuredAt}</Table.Td>
                <Table.Td>
                  {item.values.map((v) => (
                    <Stack key={v.metric} gap={0}>
                      <Text size="sm">
                        {m.metrics[v.metric]}: {v.value} {m.units[v.unit]}{' '}
                        {measurementChange(items, item, v.metric) !== null &&
                          `(${measurementChange(items, item, v.metric)})`}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {item.sync.find((status) => status.metric === v.metric)
                          ? m.sync[
                              item.sync.find(
                                (status) => status.metric === v.metric,
                              )!.state
                            ]
                          : m.localOnly}
                      </Text>
                      {item.sync.find((status) => status.metric === v.metric)
                        ?.state === 'conflict' && (
                        <Text size="xs">
                          {m.remoteValue}:{' '}
                          {
                            item.sync.find(
                              (status) => status.metric === v.metric,
                            )!.remoteValue
                          }
                        </Text>
                      )}
                    </Stack>
                  ))}
                </Table.Td>
                <Table.Td style={{ overflowWrap: 'anywhere', maxWidth: 240 }}>
                  {item.note}
                </Table.Td>
                {writable && (
                  <Table.Td>
                    <Group>
                      {item.sync.some((status) =>
                        ['failed', 'uncertain', 'conflict'].includes(
                          status.state,
                        ),
                      ) && (
                        <Button
                          variant="default"
                          mih={44}
                          loading={retrying === item.id}
                          onClick={() => void retrySync(item.id)}
                        >
                          {m.retrySync}
                        </Button>
                      )}
                      <Button
                        variant="default"
                        mih={44}
                        disabled={busy || readResource1.coverage !== 'complete'}
                        title={
                          readResource1.coverage !== 'complete'
                            ? readWorkspaceMessages.recordUnconfirmed
                            : undefined
                        }
                        onClick={() => {
                          setEditing(item.id);
                          setEditingOriginal(item);
                          setDate(item.measuredAt);
                          setNote(item.note ?? '');
                          setValues(
                            Object.fromEntries(
                              item.values.map((v) => [v.metric, v.value]),
                            ),
                          );
                        }}
                      >
                        {m.edit}
                      </Button>
                      <Button
                        color="red"
                        mih={44}
                        disabled={busy || readResource1.coverage !== 'complete'}
                        title={
                          readResource1.coverage !== 'complete'
                            ? readWorkspaceMessages.recordUnconfirmed
                            : undefined
                        }
                        onClick={() =>
                          deleting === item.id
                            ? void remove(item.id)
                            : setDeleting(item.id)
                        }
                      >
                        {deleting === item.id ? m.confirm : m.remove}
                      </Button>
                      {deleting === item.id && (
                        <Button
                          variant="default"
                          onClick={() => setDeleting(undefined)}
                        >
                          {m.cancel}
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {renderComments &&
        items.map((item) => (
          <Paper
            key={item.id}
            withBorder
            p="md"
            data-testid={`measurement-comments-${item.id}`}
          >
            <Stack>
              <Text fw={600}>{item.measuredAt}</Text>
              {item.note && (
                <Text style={{ overflowWrap: 'anywhere' }}>{item.note}</Text>
              )}
              {renderComments(item.id)}
            </Stack>
          </Paper>
        ))}
    </Stack>
  );
}
