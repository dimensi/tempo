'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { reportRequestSchema } from '@/contracts/reports';
import { reportMessages as m } from './messages';

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function ReportForm({ ownerId }: { ownerId: string | null }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [period, setPeriod] = useState('daily');
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [html, setHtml] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  if (ready && start === null) {
    const today = new Date();
    setStart(
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
    );
  }
  const selectedStart = start ?? '';
  const finish =
    period === 'daily'
      ? selectedStart
      : period === 'weekly' && selectedStart
        ? new Date(Date.parse(`${selectedStart}T00:00:00Z`) + 6 * 86400000)
            .toISOString()
            .slice(0, 10)
        : end;
  async function generate(format: 'html' | 'pdf') {
    setError('');
    setHtml('');
    const parsed = reportRequestSchema.safeParse({
      ownerId: ownerId ?? '',
      period,
      start: selectedStart,
      end: finish,
      format,
    });
    if (!parsed.success) {
      setError(m.invalid);
      return;
    }
    pending.current = new AbortController();
    setBusy(true);
    try {
      const query = {
        ownerId: parsed.data.ownerId,
        period: parsed.data.period,
        start: parsed.data.start,
        end: parsed.data.end,
        format: parsed.data.format,
      };
      const response = await fetch(
        `/api/reports?${new URLSearchParams(query)}`,
        { signal: pending.current.signal, cache: 'no-store' },
      );
      if (!response.ok) {
        setError((await response.json()).error ?? m.failed);
        return;
      }
      if (format === 'html') setHtml(await response.text());
      else {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = `nutrition-${selectedStart}-${finish}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setError(m.failed);
    } finally {
      setBusy(false);
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
        disabled={!ready}
        label={m.period}
        value={period}
        allowDeselect={false}
        onChange={(value) => {
          setPeriod(value ?? 'daily');
          setHtml('');
        }}
        data={[
          { value: 'daily', label: m.daily },
          { value: 'weekly', label: m.weekly },
          { value: 'custom', label: m.custom },
        ]}
      />
      <TextInput
        disabled={!ready}
        type="date"
        label={m.start}
        value={selectedStart}
        onChange={(event) => {
          setStart(event.currentTarget.value);
          setHtml('');
        }}
        required
      />
      {period === 'custom' && (
        <TextInput
          disabled={!ready}
          type="date"
          label={m.end}
          value={end}
          onChange={(event) => {
            setEnd(event.currentTarget.value);
            setHtml('');
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
          mih={44}
          disabled={!ready || busy || ownerId === null}
          onClick={() => void generate('html')}
        >
          {m.preview}
        </Button>
        <Button
          mih={44}
          loading={busy}
          disabled={!ready || ownerId === null}
          onClick={() => void generate('pdf')}
        >
          {m.download}
        </Button>
      </Group>
      {html && (
        <iframe
          title={m.preview}
          sandbox=""
          srcDoc={html}
          style={{ width: '100%', height: 700, border: '1px solid #ccd4de' }}
        />
      )}
    </Stack>
  );
}
