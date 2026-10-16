'use client';
import { DateNavigation } from '@/components/shared/date-navigation';
import { browserToday } from '@/components/shared/date-navigation-dates';
import { OfflineFile } from '@/components/shared/offline-file';
import { offlineFileMessages } from '@/config/offline-files';
import { reportMessages as m } from '@/config/reports';
import { reportRequestSchema } from '@/contracts/reports';
import { apiFetch } from '@/lib/api-client';
import { useSearchParams } from 'next/navigation';
import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { weeklyRange } from './weekly-range';

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const inputStyles = { input: { fontSize: 16 } };

export function ReportForm({ ownerId }: { ownerId: string | null }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const params = useSearchParams();
  const period = params.get('period') ?? 'daily';
  const today = ready ? browserToday() : '';
  const start = params.get('start') ?? today;
  const end = params.get('end') ?? today;
  function select(name: 'period' | 'start' | 'end', value: string) {
    const url = new URL(window.location.href);
    // Include the effective dates so the selected setup remains reproducible.
    if (!url.searchParams.has('period')) url.searchParams.set('period', period);
    if (!url.searchParams.has('start')) url.searchParams.set('start', start);
    if (!url.searchParams.has('end')) url.searchParams.set('end', end);
    url.searchParams.set(name, value);
    window.history.replaceState(null, '', url);
  }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewRange, setPreviewRange] = useState('');
  const [preview, setPreview] = useState<{
    ownerId: string;
    html: string;
  } | null>(null);
  const html = preview?.ownerId === ownerId ? preview.html : '';
  const successfulPreviewKey = useRef('');
  const deniedPreviewKey = useRef('');
  const clearPrivatePreview = useCallback(
    (query: URLSearchParams) => {
      const previewQuery = new URLSearchParams(query);
      previewQuery.set('format', 'html');
      deniedPreviewKey.current = previewQuery.toString();
      successfulPreviewKey.current = '';
      setPreview(null);
      setPreviewRange('');
    },
    [setPreview, setPreviewRange],
  );
  const pending = useRef<AbortController | null>(null);
  const downloadPending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      downloadPending.current?.abort();
    },
    [],
  );
  const selectedStart = start ?? '';
  const week = weeklyRange(selectedStart);
  const finish =
    period === 'daily'
      ? selectedStart
      : period === 'weekly'
        ? (week?.end ?? '')
        : (end ?? '');
  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    // Coalesce date edits before entering the measured Chromium pipeline.
    const timer = setTimeout(async () => {
      if (!ready || ownerId === null || downloading) return;
      const parsed = reportRequestSchema.safeParse({
        ownerId,
        period,
        start: selectedStart,
        end: finish,
        format: 'html',
      });
      if (!parsed.success) {
        setBusy(false);
        setError(m.invalid);
        return;
      }
      const query = new URLSearchParams({
        ownerId,
        period: parsed.data.period,
        start: parsed.data.start,
        end: parsed.data.end,
        format: 'html',
      });
      // Returning from Download does not regenerate an already visible range.
      if (
        successfulPreviewKey.current === query.toString() ||
        deniedPreviewKey.current === query.toString()
      ) {
        setBusy(false);
        return;
      }
      setError('');
      setBusy(true);
      try {
        const response = await apiFetch(`/api/reports?${query}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          if (
            (response.status === 401 || response.status === 403) &&
            !controller.signal.aborted
          ) {
            clearPrivatePreview(query);
            setError(m.denied);
            return;
          }
          const failure = await response.json();
          if (!controller.signal.aborted) setError(failure.error ?? m.failed);
          return;
        }
        const nextHtml = await response.text();
        if (!controller.signal.aborted) {
          deniedPreviewKey.current = '';
          successfulPreviewKey.current = query.toString();
          setPreview({ ownerId, html: nextHtml });
          setPreviewRange(`${parsed.data.start} — ${parsed.data.end}`);
        }
      } catch {
        if (!controller.signal.aborted) setError(m.failed);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    ready,
    ownerId,
    period,
    selectedStart,
    finish,
    downloading,
    clearPrivatePreview,
  ]);
  async function download() {
    const parsed = reportRequestSchema.safeParse({
      ownerId: ownerId ?? '',
      period,
      start: selectedStart,
      end: finish,
      format: 'pdf',
    });
    if (!parsed.success) {
      setError(m.invalid);
      return;
    }
    pending.current?.abort();
    const controller = new AbortController();
    downloadPending.current = controller;
    setDownloading(true);
    setBusy(false);
    setError('');
    try {
      const query = new URLSearchParams({
        ownerId: parsed.data.ownerId,
        period: parsed.data.period,
        start: parsed.data.start,
        end: parsed.data.end,
        format: 'pdf',
      });
      const response = await apiFetch(`/api/reports?${query}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        if (
          (response.status === 401 || response.status === 403) &&
          !controller.signal.aborted
        ) {
          clearPrivatePreview(query);
          setError(m.denied);
          return;
        }
        setError((await response.json()).error ?? m.failed);
        return;
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nutrition-${parsed.data.start}-${parsed.data.end}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (!controller.signal.aborted) setError(m.failed);
    } finally {
      if (!controller.signal.aborted) setDownloading(false);
    }
  }
  return (
    <Stack>
      <Title order={1}>{m.title}</Title>
      <Text c="dimmed">{m.description}</Text>
      {ownerId === null && (
        <Alert color="red" role="alert">
          {m.denied}
        </Alert>
      )}
      <Select
        styles={inputStyles}
        disabled={!ready}
        label={m.period}
        value={period}
        allowDeselect={false}
        onChange={(value) => {
          deniedPreviewKey.current = '';
          select('period', value ?? 'daily');
          setError('');
        }}
        data={[
          { value: 'daily', label: m.daily },
          { value: 'weekly', label: m.weekly },
          { value: 'custom', label: m.custom },
        ]}
      />
      {week && (
        <DateNavigation
          key={selectedStart}
          date={selectedStart}
          labels={m}
          onSelect={(value) => {
            deniedPreviewKey.current = '';
            select('start', value);
            setError('');
          }}
          disabled={!ready || ownerId === null}
        />
      )}
      <TextInput
        styles={inputStyles}
        disabled={!ready}
        type="date"
        label={period === 'weekly' ? m.periodStart : m.start}
        description={
          period === 'weekly' && week
            ? `${m.weekRange}: ${week.label} · ${m.sevenDays}`
            : undefined
        }
        value={selectedStart}
        onChange={(event) => {
          deniedPreviewKey.current = '';
          select('start', event.currentTarget.value);
          setError('');
        }}
        required
      />
      {period === 'custom' && (
        <TextInput
          styles={inputStyles}
          disabled={!ready}
          type="date"
          label={m.end}
          value={end ?? ''}
          onChange={(event) => {
            deniedPreviewKey.current = '';
            select('end', event.currentTarget.value);
            setError('');
          }}
          required
        />
      )}
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      <Group>
        <Button
          styles={{ root: { fontSize: 16 } }}
          mih={44}
          loading={downloading}
          disabled={!ready || ownerId === null || busy}
          onClick={() => void download()}
        >
          {m.download}
        </Button>
        {busy && (
          <Text role="status" c="dimmed">
            {m.loadingPreview}
          </Text>
        )}
      </Group>
      {ownerId && finish && selectedStart && (
        <>
          <OfflineFile
            id={`report:${period}:${selectedStart}:${finish}`}
            label={`${m.title}: ${selectedStart} — ${finish}`}
            kind="pdf"
            href={`/api/reports?${new URLSearchParams({ ownerId, period, start: selectedStart, end: finish, format: 'pdf' })}`}
          />
          <Text size="sm" c="dimmed">
            {offlineFileMessages.limit}
          </Text>
        </>
      )}
      {html && (
        <Text size="sm">
          {m.preview}: {previewRange}
        </Text>
      )}
      {ownerId !== null && (
        <iframe
          title={m.preview}
          aria-busy={busy}
          sandbox=""
          srcDoc={html}
          style={{ width: '100%', height: 700, border: '1px solid #ccd4de' }}
        />
      )}
    </Stack>
  );
}
