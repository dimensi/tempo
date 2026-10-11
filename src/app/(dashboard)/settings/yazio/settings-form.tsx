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
  PasswordInput,
  Accordion,
  Checkbox,
  Modal,
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [httpsError, setHttpsError] = useState(false);
  const today = new Date().toLocaleDateString('en-CA');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'success' | 'failure' | null>(null);
  async function submit(path: string, body: unknown) {
    setBusy(true);
    setResult(null);
    setHttpsError(false);
    if (
      (path === '/api/yazio/connect' || path === '/api/yazio/token') &&
      window.location.protocol !== 'https:' &&
      !(
        process.env.NODE_ENV === 'development' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
      )
    ) {
      setPassword('');
      setToken('');
      setConsent(false);
      setHttpsError(true);
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      setToken('');
      setConsent(false);
      const refreshed = await fetch('/api/yazio/status', { cache: 'no-store' });
      if (!refreshed.ok) throw new Error();
      setStatus(await refreshed.json());
      setResult('success');
    } catch {
      setResult('failure');
    } finally {
      setPassword('');
      setToken('');
      setConsent(false);
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
      {httpsError && (
        <Alert color="red" role="alert">
          {messages.httpsRequired}
        </Alert>
      )}
      {!status.tokenFileConfigured && (
        <Alert color="yellow">{messages.storeUnavailable}</Alert>
      )}
      <Text size="sm" c="dimmed">
        {messages.connectionHelp}
      </Text>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const input = { email, password };
          setPassword('');
          void submit('/api/yazio/connect', input);
        }}
      >
        <Stack>
          <TextInput
            label={messages.email}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            required
            disabled={busy || !status.tokenFileConfigured}
          />
          <PasswordInput
            label={messages.password}
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            visibilityToggleButtonProps={{
              'aria-label': messages.passwordVisibility,
            }}
            required
            disabled={busy || !status.tokenFileConfigured}
          />
          <Button
            type="submit"
            loading={busy}
            disabled={
              !status.tokenFileConfigured || !email || !password || !consent
            }
          >
            {messages.connect}
          </Button>
          <Checkbox
            label={messages.connectionConsent}
            checked={consent}
            onChange={(event) => setConsent(event.currentTarget.checked)}
            disabled={busy || !status.tokenFileConfigured}
          />
        </Stack>
      </form>
      {status.configured && (
        <Button
          color="red"
          variant="light"
          disabled={busy}
          onClick={() => setDisconnectOpen(true)}
        >
          {messages.disconnect}
        </Button>
      )}
      <Modal
        opened={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title={messages.disconnectTitle}
      >
        <Stack>
          <Text>{messages.disconnectHelp}</Text>
          <Group>
            <Button variant="default" onClick={() => setDisconnectOpen(false)}>
              {messages.cancel}
            </Button>
            <Button
              color="red"
              loading={busy}
              onClick={() => {
                setDisconnectOpen(false);
                void submit('/api/yazio/disconnect', {});
              }}
            >
              {messages.disconnect}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Accordion onChange={() => setToken('')}>
        <Accordion.Item value="token">
          <Accordion.Control>{messages.advanced}</Accordion.Control>
          <Accordion.Panel>
            <Text size="sm" c="dimmed" mb="sm">
              {messages.tokenHelp}
            </Text>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  void submit('/api/yazio/token', JSON.parse(token));
                } catch {
                  setToken('');
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
                  disabled={!status.tokenFileConfigured || !token || !consent}
                >
                  {messages.save}
                </Button>
              </Stack>
            </form>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
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
