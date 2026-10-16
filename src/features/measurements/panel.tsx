'use client';
import { offlineMessages } from '@/config/offline';
import { writeMessages } from '@/config/offline-write-messages';
import { readWorkspaceMessages } from '@/config/read-workspace';
import type { WeightHistory } from '@/contracts/health';
import {
  measurementInputSchema,
  measurementMetrics,
  type Measurement,
  type MeasurementMetric,
} from '@/contracts/measurements';
import { type MeasurementPrecisionIssue } from '@/contracts/yazio-body';
import { apiFetch } from '@/lib/api-client';
import { apiResults } from '@/lib/api-results';
import { updateClientRead } from '@/lib/client-read';
import { formatDecimal } from '@/lib/number-display';
import {
  saveDeviceWrite,
  synchronizeDeviceWrite,
} from '@/lib/offline-write-client';
import { readResources } from '@/lib/read-descriptors';
import { sessionGeneration } from '@/lib/session-state';
import { useReadResource } from '@/lib/use-read-resource';
import { useViewState } from '@/lib/use-view-state';
import { LineChart } from '@mantine/charts';
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
import { useEffect, useState, type ReactNode } from 'react';
import { measurementChange, weightTrendChart } from './history';
import { measurementMessages as m } from './messages';
import { MeasurementPrecisionWarnings } from './precision-warnings';
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
}: {
  ownerId: string;
  writable: boolean;
  deviceWrites?: boolean;
  weightHistory: WeightHistory;
  renderComments?: (measurementId: string) => ReactNode;
}) {
  const [issues, setIssues] = useState<MeasurementPrecisionIssue[]>([]);
  const [retrying, setRetrying] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editingOriginal, setEditingOriginal] = useViewState<
    Measurement | undefined
  >(`measurements:original`, undefined);
  const [editing, setEditing] = useViewState<string | undefined>(
    `measurements:editing`,
    undefined,
  );
  const [deleting, setDeleting] = useState<string>();
  const [date, setDate] = useViewState(
    `measurements:date`,
    new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useViewState(`measurements:note`, '');
  const [values, setValues] = useViewState<
    Partial<Record<MeasurementMetric, string>>
  >(`measurements:values`, {});
  const [metric, setMetric] = useViewState<MeasurementMetric>(
    `measurements:metric`,
    'weight',
  );
  const url = `/api/measurements?ownerId=${encodeURIComponent(ownerId)}`;
  const measurements = useReadResource(readResources.measurements(url));
  const items = measurements.data ?? [];
  const refresh = measurements.refresh;
  const loading = measurements.data === undefined && !measurements.error;
  const hasPendingSync = items.some((item) =>
    item.sync.some(
      (status) => status.state === 'pending' || status.state === 'uncertain',
    ),
  );
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
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(
      `/api/measurements/sync?ownerId=${encodeURIComponent(ownerId)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (response.ok) {
          const data = apiResults.measurementIssues(await response.json());
          if (!controller.signal.aborted) setIssues(data);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [ownerId, measurements.data]);
  useEffect(() => {
    if (!hasPendingSync) return;
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [hasPendingSync, refresh]);
  async function retrySync(id: string) {
    const generation = sessionGeneration();
    setRetrying(id);
    setError(undefined);
    try {
      const response = await apiFetch(
        `/api/measurements/${id}/retry?ownerId=${encodeURIComponent(ownerId)}`,
        { method: 'POST' },
      );
      if (!response.ok) {
        setError(responseError(response.status));
        return;
      }
      if (generation === sessionGeneration()) await refresh();
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
    const generation = sessionGeneration();
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
        const acknowledged = await synchronizeDeviceWrite(operation);
        if (generation !== sessionGeneration()) return;
        if (acknowledged) await refresh();
        else
          await updateClientRead(
            readResources.measurements(url),
            (current = []) => [
              ...current.filter((item) => item.id !== operation.recordId),
              { ...parsed.data, id: operation.recordId, ownerId, sync: [] },
            ],
            generation,
          );
        if (generation === sessionGeneration()) reset();
        return;
      }
      const r = await apiFetch(
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
      if (generation !== sessionGeneration()) return;
      await refresh();
      if (generation === sessionGeneration()) reset();
    } catch {
      setError(deviceWrites ? writeMessages.error : m.error);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    const generation = sessionGeneration();
    setBusy(true);
    setError(undefined);
    try {
      const r = await apiFetch(
        `/api/measurements/${id}?ownerId=${encodeURIComponent(ownerId)}`,
        { method: 'DELETE' },
      );
      if (!r.ok) {
        setError(responseError(r.status));
        return;
      }
      if (generation !== sessionGeneration()) return;
      await refresh();
      if (generation === sessionGeneration()) {
        setDeleting(undefined);
        if (editing === id) reset();
      }
    } catch {
      setError(m.error);
    } finally {
      setBusy(false);
    }
  }
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
      {(error || measurements.error) && (
        <Alert color="red" role="alert">
          {error ?? m.loadError}
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
                        disabled={busy || measurements.coverage !== 'complete'}
                        title={
                          measurements.coverage !== 'complete'
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
                        disabled={busy || measurements.coverage !== 'complete'}
                        title={
                          measurements.coverage !== 'complete'
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
