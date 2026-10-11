'use client';
import { useState, useSyncExternalStore } from 'react';
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
  resolveSyncPeriod,
} from '@/contracts/nutrition-sync';
import { dateInTimezone, shiftDate } from '@/contracts/nutrition-sync-dates';
const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

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
  const ready = useSyncExternalStore(
    subscribeToHydration,
    clientReady,
    serverReady,
  );
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [httpsError, setHttpsError] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [customEnd, setCustomEnd] = useState(false);
  const timezone = ready
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC';
  const today = ready ? dateInTimezone(new Date(), timezone) : '';
  const start = from ?? (today ? shiftDate(today, -6) : '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | 'success'
    | 'failure'
    | 'connectionLoaded'
    | 'connectionSyncFailed'
    | 'syncLoaded'
    | 'syncFailed'
    | 'rangeInvalid'
    | null
  >(null);
  function periodRequest(end?: string) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
      mode: 'period',
      from: from ?? shiftDate(dateInTimezone(new Date(), zone), -6),
      ...(end ? { to: end } : {}),
      timezone: zone,
    };
  }
  async function loadDiary(body: unknown) {
    const response = await fetch('/api/yazio/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error();
    const sync: SyncStatus = await response.json();
    setStatus((current) => ({ ...current, sync }));
    if (sync.state !== 'completed') throw new Error();
  }
  async function submit(path: string, body: unknown) {
    if (path === '/api/yazio/connect' || path === '/api/yazio/sync') {
      try {
        resolveSyncPeriod(
          path === '/api/yazio/connect' ? periodRequest() : body,
        );
      } catch {
        setPassword('');
        setResult('rangeInvalid');
        return;
      }
    }
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
      if (path === '/api/yazio/connect') {
        // Keep successful connection visible even when diary loading fails.
        setStatus((current) => ({ ...current, configured: true }));
        try {
          await loadDiary(periodRequest());
          setResult('connectionLoaded');
        } catch {
          setResult('connectionSyncFailed');
        }
      } else if (path === '/api/yazio/sync') {
        const sync: SyncStatus = await response.json();
        setStatus((current) => ({ ...current, sync }));
        setResult(sync.state === 'completed' ? 'syncLoaded' : 'syncFailed');
      } else {
        setStatus((current) => ({
          ...current,
          configured: path === '/api/yazio/token',
        }));
        setResult('success');
      }
    } catch {
      setResult(path === '/api/yazio/sync' ? 'syncFailed' : 'failure');
    } finally {
      setPassword('');
      setToken('');
      setConsent(false);
      setBusy(false);
    }
  }
  const connectionForm = (
    <>
      <Text size="sm" c="dimmed">
        {messages.connectionHelp}
      </Text>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || busy || !status.tokenFileConfigured || !consent) {
            setPassword('');
            return;
          }
          const input = { email, password, confirmed: true };
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
            disabled={!ready || busy || !status.tokenFileConfigured}
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
            disabled={!ready || busy || !status.tokenFileConfigured}
          />
          <Checkbox
            label={messages.connectionConsent}
            checked={consent}
            onChange={(event) => setConsent(event.currentTarget.checked)}
            disabled={!ready || busy || !status.tokenFileConfigured}
          />
          <Button
            type="submit"
            loading={busy}
            disabled={
              !ready ||
              !status.tokenFileConfigured ||
              !email ||
              !password ||
              !consent
            }
          >
            {messages.connect}
          </Button>
        </Stack>
      </form>
    </>
  );
  return (
    <Stack maw={600}>
      {!ready && <Text role="status">{messages.loading}</Text>}
      <Title order={1}>{messages.title}</Title>
      <Badge color={status.configured ? 'teal' : 'gray'}>
        {status.configured ? messages.configured : messages.absent}
      </Badge>
      {result && (
        <Alert
          color={
            [
              'failure',
              'syncFailed',
              'connectionSyncFailed',
              'rangeInvalid',
            ].includes(result)
              ? 'red'
              : 'teal'
          }
          role="status"
        >
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
      <TextInput
        label={messages.from}
        type="date"
        value={start}
        onChange={(event) => setFrom(event.currentTarget.value)}
        required
        max={today || undefined}
        disabled={!ready || busy}
      />
      <Text size="sm" c="dimmed">
        {messages.today}. {messages.rangeHelp}
      </Text>
      {!status.configured && connectionForm}
      {status.configured && (
        <Button
          disabled={!ready || busy}
          loading={busy}
          onClick={() => void submit('/api/yazio/sync', periodRequest())}
        >
          {messages.recent}
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
                void submit('/api/yazio/disconnect', { confirmed: true });
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
            <Stack>
              {status.configured && connectionForm}
              {status.configured && (
                <Button
                  color="red"
                  variant="light"
                  disabled={!ready || busy}
                  onClick={() => setDisconnectOpen(true)}
                >
                  {messages.disconnect}
                </Button>
              )}

              <Text size="sm" c="dimmed" mb="sm">
                {messages.tokenHelp}
              </Text>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    !ready ||
                    busy ||
                    !status.tokenFileConfigured ||
                    !consent
                  ) {
                    setToken('');
                    return;
                  }
                  try {
                    void submit('/api/yazio/token', {
                      token: JSON.parse(token),
                      confirmed: true,
                    });
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
                    disabled={!ready || busy || !status.tokenFileConfigured}
                  />
                  <Button
                    type="submit"
                    loading={busy}
                    disabled={
                      !ready ||
                      !status.tokenFileConfigured ||
                      !token ||
                      !consent
                    }
                  >
                    {messages.save}
                  </Button>
                </Stack>
              </form>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!ready || busy || !status.configured) return;
                  void submit(
                    '/api/yazio/sync',
                    periodRequest(customEnd ? to : undefined),
                  );
                }}
              >
                <Stack>
                  <Checkbox
                    label={messages.toCustom}
                    checked={customEnd}
                    onChange={(event) =>
                      setCustomEnd(event.currentTarget.checked)
                    }
                    disabled={!ready || busy}
                  />
                  {customEnd && (
                    <TextInput
                      label={messages.to}
                      type="date"
                      value={to}
                      onChange={(event) => setTo(event.currentTarget.value)}
                      required
                      max={today || undefined}
                      disabled={!ready || busy}
                    />
                  )}
                  <Button
                    type="submit"
                    loading={busy}
                    disabled={!ready || !status.configured}
                  >
                    {messages.period}
                  </Button>
                </Stack>
              </form>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      <Text role="status">
        {messages.status}: {messages.states[status.sync.state]} (
        {status.sync.completedDates.length}/
        {status.sync.completedDates.length + status.sync.failedDates.length})
      </Text>
    </Stack>
  );
}
