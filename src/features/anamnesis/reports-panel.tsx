'use client';
import { OfflineFile } from '@/components/shared/offline-file';
import { apiFetch } from '@/lib/api-client';
import { useReadOnline } from '@/lib/use-read-online';
import { useReadRefresh } from '@/lib/use-read-refresh';

import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import type {
  AnamnesisMarkerSummary,
  MedicalReportDateOption,
  MedicalReportExport,
  MedicalReportPreview,
} from '@/contracts/anamnesis';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnamnesisFetchError, fetchAnamnesis, ownerIdQuery } from './api';
import { useAnamnesisRevision } from './refresh';

async function fetchPreview(url: string, body: string, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await fetchAnamnesis<MedicalReportPreview>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal,
        cache: 'no-store',
      });
    } catch (error) {
      if (
        !(error instanceof AnamnesisFetchError) ||
        error.status !== 429 ||
        attempt >= 2
      )
        throw error;
      // An aborted Chromium render needs a short bounded interval to release its slot.
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 500));
    }
  }
}
function dateLabel(key: string) {
  if (key === 'undated') return m.workspace.undated;
  const parts = key.split('-');
  return parts.length === 2
    ? `${parts[1]}.${parts[0]} (${m.workspace.month})`
    : `${parts[2]}.${parts[1]}.${parts[0]}`;
}
function ReportPreview({ preview }: { preview: MedicalReportPreview }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0]!.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(1, width / ((210 * 96) / 25.4));
  const height = (preview.pageCount * 297 * 96) / 25.4;
  return (
    <div
      ref={container}
      style={{ width: '100%', overflow: 'hidden', height: height * scale }}
    >
      <iframe
        title={m.workspace.preview}
        sandbox=""
        srcDoc={preview.html}
        style={{
          width: '210mm',
          height,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  );
}
export function ReportsPanel({ ownerId }: { ownerId: string }) {
  const query = ownerIdQuery(ownerId);
  const online = useReadOnline();
  const readRefresh = useReadRefresh();
  const revision = useAnamnesisRevision();
  const [items, setItems] = useState<MedicalReportExport[]>([]);
  const [markers, setMarkers] = useState<AnamnesisMarkerSummary[]>([]);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [dates, setDates] = useState<MedicalReportDateOption[]>([]);
  const [datesFor, setDatesFor] = useState('');
  const [dateKeys, setDateKeys] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<MedicalReportPreview>();
  const [saved, setSaved] = useState<string>();
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loadingKey, setLoadingKey] = useState('');
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const [previewSelection, setPreviewSelection] = useState('');
  const markerIds = useMemo(
    () =>
      (selected ?? markers.map((item) => item.marker.id)).filter((id) =>
        markers.some((item) => item.marker.id === id),
      ),
    [selected, markers],
  );
  const datesKey = `${JSON.stringify([...markerIds].sort())}:${revision}`;
  const selection = JSON.stringify({
    markerIds: [...markerIds].sort(),
    dateKeys: dateKeys === null ? null : [...dateKeys].sort(),
  });
  const current = `${selection}:${revision}:${refresh}`;
  const loading = loadingKey === current;
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  function clearPrivate() {
    setDenied(true);
    setPreview(undefined);
    setSaved(undefined);
    setItems([]);
    setDates([]);
  }
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetchAnamnesis<MedicalReportExport[]>(`/api/anamnesis/reports?${query}`, {
        signal: controller.signal,
        cache: 'no-store',
      }),
      fetchAnamnesis<AnamnesisMarkerSummary[]>(
        `/api/anamnesis/markers?${query}`,
        { signal: controller.signal, cache: 'no-store' },
      ),
    ])
      .then(([reports, list]) => {
        if (controller.signal.aborted) return;
        setItems(reports);
        setSaved((old) =>
          reports.some((item) => item.id === old) ? old : undefined,
        );
        setMarkers(list.filter((item) => item.observationCount > 0));
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          if (
            cause instanceof AnamnesisFetchError &&
            [401, 403].includes(cause.status)
          )
            clearPrivate();
          setError(m.errors.load);
        }
      });
    return () => controller.abort();
  }, [query, revision, refresh, readRefresh]);
  useEffect(() => {
    const controller = new AbortController();
    if (!online || !markerIds.length) return;
    void fetchAnamnesis<MedicalReportDateOption[]>(
      `/api/anamnesis/reports/dates?${query}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markerIds, dateKeys: null }),
        signal: controller.signal,
        cache: 'no-store',
      },
    )
      .then((options) => {
        if (!controller.signal.aborted) {
          setDates(options);
          setDatesFor(datesKey);
          setDateKeys((old) =>
            old === null
              ? null
              : old.filter((key) =>
                  options.some((option) => option.key === key),
                ),
          );
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          if (
            cause instanceof AnamnesisFetchError &&
            [401, 403].includes(cause.status)
          )
            clearPrivate();
          setError(m.errors.load);
        }
      });
    return () => controller.abort();
    // Date options depend on marker selection, not on the selected dates.
  }, [markerIds, query, revision, datesKey, online]);
  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    if (!online) return;
    const input = JSON.parse(selection) as {
      markerIds: string[];
      dateKeys: string[] | null;
    };
    if (!input.markerIds.length || input.dateKeys?.length === 0) return;
    const timer = setTimeout(() => {
      setLoadingKey(current);
      setError(undefined);
      void fetchPreview(
        `/api/anamnesis/reports/preview?${query}`,
        selection,
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted && version === generation.current) {
            setPreview(result);
            setPreviewSelection(current);
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted && version === generation.current) {
            if (
              cause instanceof AnamnesisFetchError &&
              [401, 403].includes(cause.status)
            )
              clearPrivate();
            setError(m.errors.load);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted && version === generation.current)
            setLoadingKey('');
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [current, query, selection, online]);
  async function download() {
    if (!preview || previewSelection !== current) return;
    const key = current;
    setBusy(true);
    setError(undefined);
    try {
      const created = await fetchAnamnesis<{ id: string }>(
        `/api/anamnesis/reports?${query}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...JSON.parse(selection),
            snapshotKey: preview.snapshotKey,
          }),
        },
      );
      if (key !== currentRef.current) return;
      const response = await apiFetch(
        `/api/anamnesis/reports/${created.id}/file?${query}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new AnamnesisFetchError(response.status);
      const blob = await response.blob();
      if (key !== currentRef.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `anamnesis-${new Date().toISOString().slice(0, 10)}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setItems(
        await fetchAnamnesis<MedicalReportExport[]>(
          `/api/anamnesis/reports?${query}`,
          { cache: 'no-store' },
        ),
      );
    } catch (cause) {
      if (
        cause instanceof AnamnesisFetchError &&
        [401, 403].includes(cause.status)
      )
        clearPrivate();
      if (cause instanceof AnamnesisFetchError && cause.status === 409) {
        setRefresh((value) => value + 1);
        setPreview(undefined);
      }
      setError(
        cause instanceof AnamnesisFetchError && cause.status === 409
          ? m.workspace.stale
          : m.errors.save,
      );
    } finally {
      setBusy(false);
    }
  }
  if (denied)
    return (
      <Stack data-testid="anamnesis-reports">
        <Title order={2}>{m.workspace.export}</Title>
        <Alert color="red" role="alert">
          {m.errors.denied}
        </Alert>
      </Stack>
    );
  return (
    <Stack data-testid="anamnesis-reports">
      <Title order={2}>{m.workspace.export}</Title>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      <Paper withBorder p="md">
        <Stack>
          <Checkbox
            label={m.reports.builder.selectAll}
            checked={!!markers.length && markerIds.length === markers.length}
            indeterminate={
              markerIds.length > 0 && markerIds.length < markers.length
            }
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setSelected(checked ? markers.map((item) => item.marker.id) : []);
            }}
            styles={{ body: { minHeight: 44, alignItems: 'center' } }}
          />
          <Stack gap={0} role="group" aria-label={m.reports.builder.markers}>
            {markers.map((item) => (
              <Checkbox
                key={item.marker.id}
                label={`${item.marker.name} (${item.observationCount})`}
                checked={markerIds.includes(item.marker.id)}
                styles={{ body: { minHeight: 44, alignItems: 'center' } }}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelected(
                    checked
                      ? [...markerIds, item.marker.id]
                      : markerIds.filter((id) => id !== item.marker.id),
                  );
                }}
              />
            ))}
          </Stack>
          <Text size="sm" role="status">
            {m.reports.builder.selected}: {markerIds.length} / {markers.length}
          </Text>
          <Checkbox
            label={m.workspace.allHistory}
            disabled={datesFor !== datesKey}
            checked={dateKeys === null}
            onChange={(event) =>
              setDateKeys(
                event.currentTarget.checked
                  ? null
                  : dates.map((item) => item.key),
              )
            }
            styles={{ body: { minHeight: 44, alignItems: 'center' } }}
          />
          {dateKeys !== null && datesFor === datesKey && (
            <Stack gap={0} role="group" aria-label={m.workspace.dates}>
              {dates.map((option) => (
                <Checkbox
                  key={option.key}
                  label={`${dateLabel(option.key)} (${option.count})`}
                  checked={dateKeys.includes(option.key)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setDateKeys((old) =>
                      checked
                        ? [...(old ?? []), option.key]
                        : (old ?? []).filter((key) => key !== option.key),
                    );
                  }}
                  styles={{ body: { minHeight: 44, alignItems: 'center' } }}
                />
              ))}
            </Stack>
          )}
          <Button
            mih={44}
            onClick={() => void download()}
            loading={busy}
            disabled={
              !online || !preview || previewSelection !== current || loading
            }
          >
            {m.workspace.download}
          </Button>
        </Stack>
      </Paper>
      {loading && <Text role="status">{m.workspace.previewLoading}</Text>}
      {!loading && !preview && !error && <Text>{m.workspace.empty}</Text>}
      {preview && previewSelection === current && (
        <ReportPreview preview={preview} />
      )}
      <Title order={3}>{m.workspace.snapshots}</Title>
      {items.map((item) => (
        <Group
          key={item.id}
          data-testid={`medical-report-${item.id}`}
          justify="space-between"
          wrap="wrap"
        >
          <div>
            <Text fw={600}>
              {m.reportTitle} · {item.markerIds.length}
            </Text>
            <Text size="sm" c="dimmed">
              {item.historicalPeriod?.from || item.historicalPeriod?.to
                ? `${item.historicalPeriod.from ?? '…'} — ${item.historicalPeriod.to ?? '…'}`
                : (item.dateKeys?.map(dateLabel).join(', ') ??
                  m.workspace.allHistory)}{' '}
              · {new Date(item.createdAt).toLocaleString('ru-RU')}
            </Text>
          </div>
          <Group gap="xs">
            <Button variant="default" onClick={() => setSaved(item.id)}>
              {m.workspace.view}
            </Button>
            {online && (
              <Button
                component="a"
                href={`/api/anamnesis/reports/${item.id}/file?${query}`}
              >
                {m.reports.download}
              </Button>
            )}
            <OfflineFile
              id={`medical-report:${item.id}`}
              label={item.filename ?? m.reports.download}
              kind="pdf"
              size={item.sizeBytes ?? undefined}
              href={`/api/anamnesis/reports/${item.id}/file?${query}`}
              offline={!online}
            />
          </Group>
        </Group>
      ))}
      {saved && online && (
        <Stack>
          <Button
            component="a"
            href={`/api/anamnesis/reports/${saved}/file?${query}&inline=1`}
            target="_blank"
            rel="noreferrer"
            variant="subtle"
          >
            {m.workspace.newTab}
          </Button>
          <iframe
            title={m.workspace.snapshots}
            src={`/api/anamnesis/reports/${saved}/file?${query}&inline=1`}
            style={{ width: '100%', height: 700, border: 0 }}
          />
        </Stack>
      )}
    </Stack>
  );
}
