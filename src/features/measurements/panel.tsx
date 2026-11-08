'use client';
import { PageHeader } from '@/components/layout/page-header';
import { browserToday } from '@/components/shared/date-navigation-dates';
import { offlineMessages } from '@/config/offline';
import { writeMessages } from '@/config/offline-write-messages';
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
  CloseButton,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MeasurementFields, type MeasurementDraftValues } from './editor';
import { weightTrendChart } from './history';
import { measurementMessages as m } from './messages';
import { MeasurementPrecisionWarnings } from './precision-warnings';
import { MeasurementRecords } from './records';
import styles from './measurements.module.css';
const shortChartDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function chartDate(value: unknown) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))
    return '';
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
function responseError(status: number, fallback = m.error) {
  return status === 401
    ? m.sessionExpired
    : status === 403
      ? m.forbidden
      : status === 400
        ? m.validation
        : fallback;
}
export function MeasurementsPanel({
  ownerId,
  deviceWrites = false,
  writable,
  weightHistory,
  weightDetails,
  renderComments,
}: {
  ownerId: string;
  writable: boolean;
  deviceWrites?: boolean;
  weightHistory: WeightHistory;
  weightDetails: ReactNode;
  renderComments?: (measurementId: string) => ReactNode;
}) {
  const [issues, setIssues] = useState<MeasurementPrecisionIssue[]>([]);
  const [retrying, setRetrying] = useState<string>();
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [formVisibility, setFormVisibility] = useState<boolean>();
  const mobile = useMediaQuery('(max-width: 47.99em)');
  const touch = useMediaQuery('(pointer: coarse)');
  const wide = useMediaQuery('(min-width: 72em)');
  const formOpened = writable && (formVisibility ?? wide);
  const editorId = useId();
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const trendHeading = useId();
  const [editingOriginal, setEditingOriginal] = useViewState<
    Measurement | undefined
  >(`measurements:original`, undefined);
  const [editing, setEditing] = useViewState<string | undefined>(
    `measurements:editing`,
    undefined,
  );
  const [deleting, setDeleting] = useState<string>();
  const [date, setDate] = useViewState(`measurements:date`, browserToday);
  const [note, setNote] = useViewState(`measurements:note`, '');
  const [values, setValues] = useViewState<MeasurementDraftValues>(
    `measurements:values`,
    {},
  );
  const [metric, setMetric] = useViewState<MeasurementMetric>(
    `measurements:metric`,
    'weight',
  );
  const url = `/api/measurements?ownerId=${encodeURIComponent(ownerId)}`;
  const measurements = useReadResource(readResources.measurements(url));
  const items = [...(measurements.data ?? [])].sort((a, b) =>
    b.measuredAt.localeCompare(a.measuredAt),
  );
  const hasDraft = Boolean(
    editing || note || Object.keys(values).length || date !== browserToday(),
  );
  const editBlocked = (id: string) => hasDraft && editing !== id;
  const confirmed = measurements.coverage === 'complete';
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
    measurements.data !== undefined &&
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
  useEffect(() => {
    if (wide && formVisibility) editorHeading.current?.focus();
  }, [wide, formVisibility]);
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
        setError(responseError(response.status, m.syncError));
        return;
      }
      if (generation === sessionGeneration()) await refresh();
    } catch {
      setError(m.syncError);
    } finally {
      setRetrying(undefined);
    }
  }
  function closeForm() {
    setFormError(undefined);
    setFormVisibility(false);
    if (wide && formOpened) addButton.current?.focus();
  }
  function openForm() {
    if (formOpened) editorHeading.current?.focus();
    else {
      setFormError(undefined);
      setFormVisibility(true);
    }
  }
  function reset() {
    setEditing(undefined);
    setEditingOriginal(undefined);
    setValues({});
    setNote('');
    setDate(browserToday());
    closeForm();
  }
  function edit(item: Measurement) {
    if (editBlocked(item.id)) return;
    if (editing !== item.id) {
      setEditing(item.id);
      setEditingOriginal(item);
      setDate(item.measuredAt);
      setNote(item.note ?? '');
      setValues(
        Object.fromEntries(
          item.values.map(({ metric, value }) => [metric, value]),
        ),
      );
    }
    openForm();
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
      setFormError(m.validation);
      return;
    }
    const generation = sessionGeneration();
    setBusy(true);
    setFormError(undefined);
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
        setFormError(responseError(r.status));
        return;
      }
      if (generation !== sessionGeneration()) return;
      await refresh();
      if (generation === sessionGeneration()) reset();
    } catch {
      setFormError(deviceWrites ? writeMessages.error : m.error);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!confirmed) return;
    const generation = sessionGeneration();
    setBusy(true);
    setError(undefined);
    try {
      const r = await apiFetch(
        `/api/measurements/${id}?ownerId=${encodeURIComponent(ownerId)}`,
        { method: 'DELETE' },
      );
      if (!r.ok) {
        setError(responseError(r.status, m.deleteError));
        return;
      }
      if (generation !== sessionGeneration()) return;
      await refresh();
      if (generation === sessionGeneration()) {
        setDeleting(undefined);
        if (editing === id) reset();
      }
    } catch {
      setError(m.deleteError);
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
  const unit = m.units[metric === 'weight' ? 'kg' : 'cm'];
  const latest = chart.findLast((point) => point.value !== null);
  const pageError = deleting ? undefined : error;
  const editorTitle = editing ? m.editTitle : m.add;
  const editor = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void save();
      }}
    >
      <Stack gap="md">
        {conflict && (
          <Alert color="orange">{offlineMessages.draftConflict}</Alert>
        )}
        {formError && (
          <Alert color="red" role="alert">
            {formError}
          </Alert>
        )}
        <fieldset className={styles.formFields} disabled={busy}>
          <MeasurementFields
            date={date}
            full={wide}
            nativeDate={mobile || touch}
            values={values}
            note={note}
            onDateChange={setDate}
            onValuesChange={setValues}
            onNoteChange={setNote}
          />
        </fieldset>
        <Group justify="space-between" gap="xs">
          <Button type="submit" loading={busy} mih={44}>
            {m.save}
          </Button>
          {hasDraft && (
            <Button
              size="sm"
              variant="subtle"
              color="gray"
              onClick={reset}
              disabled={busy}
              mih={44}
            >
              {m.discard}
            </Button>
          )}
        </Group>
      </Stack>
    </form>
  );

  return (
    <Stack gap="lg" data-testid="measurements-panel">
      <PageHeader
        actions={
          writable && (
            <Button
              ref={addButton}
              className={styles.headerAction}
              aria-controls={wide && formOpened ? editorId : undefined}
              aria-expanded={wide ? formOpened : undefined}
              size="sm"
              mih={44}
              leftSection={
                hasDraft ? (
                  <IconPencil size={18} aria-hidden />
                ) : (
                  <IconPlus size={18} aria-hidden />
                )
              }
              onClick={openForm}
            >
              {hasDraft ? m.resume : m.add}
            </Button>
          )
        }
      >
        {m.title}
      </PageHeader>
      {(pageError || measurements.error) && (
        <Alert color="red" role="alert">
          {pageError ?? m.loadError}
        </Alert>
      )}
      {!writable && (
        <Text size="sm" c="dimmed">
          {m.readOnly}
        </Text>
      )}
      <div
        className={styles.workspace}
        data-editing={(wide && formOpened) || undefined}
      >
        {wide && writable && formOpened && (
          <Paper
            component="section"
            withBorder
            p="md"
            radius="lg"
            id={editorId}
            aria-labelledby={`${editorId}-title`}
            className={styles.editor}
          >
            <Stack gap="sm">
              <Group justify="space-between" wrap="nowrap">
                <Title
                  order={2}
                  size="h4"
                  id={`${editorId}-title`}
                  ref={editorHeading}
                  tabIndex={-1}
                  className={styles.editorHeading}
                >
                  {editorTitle}
                </Title>
                <CloseButton
                  aria-label={m.close}
                  size={44}
                  onClick={closeForm}
                  disabled={busy}
                />
              </Group>
              {editor}
            </Stack>
          </Paper>
        )}
        <Paper
          component="section"
          withBorder
          p="md"
          radius="lg"
          aria-labelledby={trendHeading}
          className={styles.chart}
        >
          <Stack gap="sm">
            <Group justify="space-between" align="center" gap="xs">
              <Title order={2} size="h4" id={trendHeading}>
                {m.trend}
              </Title>
              <Select
                className={styles.trendSelect}
                aria-label={m.trend}
                allowDeselect={false}
                data={measurementMetrics.map((value) => ({
                  value,
                  label: m.metrics[value],
                }))}
                value={metric}
                onChange={(value) => {
                  if (value) setMetric(value as MeasurementMetric);
                }}
              />
            </Group>
            {latest && (
              <Group gap="xs" align="baseline">
                <Text fw={650} className={styles.number}>
                  {formatDecimal(latest.value)} {unit}
                </Text>
                <Text size="sm" c="dimmed">
                  {m.lastReading} · {chartDate(Date.parse(latest.date))}
                </Text>
              </Group>
            )}
            {latest ? (
              <LineChart
                data-testid="measurement-trend-chart"
                h={216}
                data={chart.map((point) => ({
                  ...point,
                  time: Date.parse(point.date),
                }))}
                dataKey="time"
                xAxisProps={{
                  type: 'number',
                  scale: 'time',
                  domain: ['dataMin', 'dataMax'],
                  tickFormatter: (value: number) =>
                    shortChartDate.format(value),
                  minTickGap: 24,
                }}
                yAxisProps={{
                  domain: [
                    (min: number) => Math.max(0, Math.floor(min - 1)),
                    (max: number) => Math.ceil(max + 1),
                  ],
                  tickCount: 4,
                }}
                tooltipProps={{ labelFormatter: chartDate }}
                withLegend={false}
                connectNulls
                valueFormatter={(value) => `${formatDecimal(value)} ${unit}`}
                series={[
                  { name: 'value', label: m.metrics[metric], color: 'teal.6' },
                ]}
              />
            ) : (
              <Text size="sm" c="dimmed">
                {loading
                  ? m.loading
                  : measurements.error
                    ? m.loadError
                    : m.noMetric}
              </Text>
            )}
          </Stack>
        </Paper>
        <div className={styles.records}>
          <MeasurementRecords
            items={items}
            loading={loading}
            loadError={Boolean(measurements.error)}
            writable={writable}
            confirmed={confirmed}
            busy={busy}
            retrying={retrying}
            editBlocked={editBlocked}
            onEdit={edit}
            onDelete={(id) => {
              setError(undefined);
              setDeleting(id);
            }}
            onRetry={(id) => void retrySync(id)}
            renderComments={renderComments}
          />
        </div>
        <Stack className={styles.sources} gap="sm">
          <MeasurementPrecisionWarnings issues={issues} />
          {weightDetails}
        </Stack>
      </div>
      {!wide && writable && (
        <Modal
          opened={formOpened}
          onClose={closeForm}
          title={editorTitle}
          centered
          fullScreen={mobile}
          size="lg"
          withCloseButton={!busy}
          closeOnEscape={!busy}
          closeOnClickOutside={!busy}
          closeButtonProps={{ 'aria-label': m.close, size: 44 }}
        >
          {editor}
        </Modal>
      )}
      {writable && (
        <Modal
          opened={Boolean(deleting)}
          onClose={() => {
            setError(undefined);
            setDeleting(undefined);
          }}
          title={m.confirm}
          centered
          withCloseButton={!busy}
          closeOnEscape={!busy}
          closeOnClickOutside={!busy}
          closeButtonProps={{ 'aria-label': m.close, size: 44 }}
        >
          <Stack>
            <Text size="sm">{m.deleteHint}</Text>
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            <Group justify="end">
              <Button
                size="sm"
                variant="default"
                mih={44}
                disabled={busy}
                onClick={() => {
                  setError(undefined);
                  setDeleting(undefined);
                }}
              >
                {m.cancel}
              </Button>
              <Button
                size="sm"
                color="red"
                mih={44}
                loading={busy}
                disabled={!confirmed}
                onClick={() => deleting && void remove(deleting)}
              >
                {m.remove}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}
