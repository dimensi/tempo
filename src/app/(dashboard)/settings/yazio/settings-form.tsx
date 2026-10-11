'use client';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import {
  nutritionSyncMessages as messages,
  type SyncStatus,
} from '@/contracts/nutrition-sync';

export function YazioSettingsForm({
  initial,
}: {
  initial: {
    configured: boolean;
    tokenFileConfigured: boolean;
    sync: SyncStatus;
  };
}) {
  const [status, setStatus] = useState(initial);
  const [token, setToken] = useState('');
  const today = new Date().toLocaleDateString('en-CA');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'success' | 'failure' | null>(null);
  async function submit(path: string, body: unknown) {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      setToken('');
      const refreshed = await fetch('/api/yazio/status', { cache: 'no-store' });
      if (!refreshed.ok) throw new Error();
      setStatus(await refreshed.json());
      setResult('success');
    } catch {
      setResult('failure');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack maw={600}>
      <Title order={1}>{messages.title}</Title>
      <Badge color={status.configured ? 'teal' : 'gray'}>
        {status.configured ? messages.configured : messages.absent}
      </Badge>
      {result && (
        <Alert color={result === 'failure' ? 'red' : 'teal'} role="status">
          {messages[result]}
        </Alert>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            void submit('/api/yazio/token', JSON.parse(token));
          } catch {
            setResult('failure');
          }
        }}
      >
        <Stack>
          <Textarea
            label={messages.token}
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
            minRows={4}
            required
            disabled={busy || !status.tokenFileConfigured}
          />
          <Button
            type="submit"
            loading={busy}
            disabled={!status.tokenFileConfigured || !token}
          >
            {messages.save}
          </Button>
        </Stack>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit('/api/yazio/sync', { mode: 'period', from, to });
        }}
      >
        <Stack>
          <Group grow wrap="wrap">
            <TextInput
              label={messages.from}
              type="date"
              value={from}
              onChange={(event) => setFrom(event.currentTarget.value)}
              required
            />
            <TextInput
              label={messages.to}
              type="date"
              value={to}
              onChange={(event) => setTo(event.currentTarget.value)}
              required
            />
          </Group>
          <Button type="submit" loading={busy} disabled={!status.configured}>
            {messages.period}
          </Button>
          <Button
            variant="light"
            loading={busy}
            disabled={!status.configured}
            onClick={() =>
              void submit('/api/yazio/sync', {
                mode: 'recent',
                days: 7,
                through: today,
              })
            }
          >
            {messages.recent}
          </Button>
        </Stack>
      </form>
      <Text role="status">
        {messages.status}: {status.sync.state} (
        {status.sync.completedDates.length}/
        {status.sync.completedDates.length + status.sync.failedDates.length})
      </Text>
    </Stack>
  );
}
