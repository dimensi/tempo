'use client';
import { useReadOnline } from '@/lib/use-read-online';
import { networkReachable } from '@/lib/network-state';
import { useState, useSyncExternalStore, useEffect } from 'react';
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
  Card,
  Avatar,
  Modal,
} from '@mantine/core';
import {
  nutritionSyncMessages as messages,
  type SyncStatus,
  type YazioAccount,
  resolveSyncPeriod,
  syncResultKind,
} from '@/contracts/nutrition-sync';
import type { NutritionScheduleStatus } from '@/contracts/nutrition-schedule';
import { dateInTimezone, shiftDate } from '@/contracts/nutrition-sync-dates';
import { withOfflineDevicePurge } from '@/lib/offline-device';
const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function YazioSettingsForm({
  initial,
  embedded = false,
}: {
  embedded?: boolean;
  initial: {
    configured: boolean;
    tokenFileConfigured: boolean;
    sync: SyncStatus;
    schedule: NutritionScheduleStatus;
    account: YazioAccount | null;
  };
}) {
  const online = useReadOnline();
  const [status, setStatus] = useState(initial);
  const ready = useSyncExternalStore(
    subscribeToHydration,
    clientReady,
    serverReady,
  );
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [httpsError, setHttpsError] = useState(false);
  const [from, setFrom] = useState<string | null>(initial.schedule.initialFrom);
  const [to, setTo] = useState('');
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
    | 'connectionPhotoWarning'
    | 'syncPhotoWarning'
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
  function connectionSchedule() {
    const request = periodRequest();
    return { timezone: request.timezone, initialFrom: request.from };
  }
  async function refreshStatus() {
    try {
      const response = await fetch('/api/yazio/status', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) setStatus(await response.json());
    } catch {
      /* A read failure must not undo a completed connect/sync. */
    }
  }
  useEffect(() => {
    if (!ready || (!status.configured && !busy)) return;
    const controller = new AbortController();
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch('/api/yazio/status', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.ok && !controller.signal.aborted)
          setStatus(await response.json());
      } catch {
        /* Keep the last known safe status. */
      } finally {
        pending = false;
      }
    }, 30000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [ready, status.configured, busy]);
  async function submit(path: string, body: unknown) {
    if (!navigator.onLine || !networkReachable()) return;
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
      setHttpsError(true);
      setBusy(false);
      return;
    }
    let outcome: Exclude<typeof result, null> = 'failure';
    try {
      const request = () =>
        fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const response =
        path === '/api/yazio/connect' ||
        path === '/api/yazio/token' ||
        path === '/api/yazio/disconnect'
          ? await withOfflineDevicePurge(request)
          : await request();
      if (!response.ok) throw new Error();
      if (path === '/api/yazio/connect' || path === '/api/yazio/token') {
        const connected: {
          configured: boolean;
          account: YazioAccount | null;
          sync: SyncStatus | null;
          syncError: string | null;
        } = await response.json();
        setStatus((current) => ({
          ...current,
          configured: connected.configured,
          account: connected.account,
          ...(connected.sync ? { sync: connected.sync } : {}),
        }));
        const kind =
          connected.sync && !connected.syncError
            ? syncResultKind(connected.sync)
            : 'incomplete';
        outcome =
          kind === 'loaded'
            ? 'connectionLoaded'
            : kind === 'photos-pending'
              ? 'connectionPhotoWarning'
              : 'connectionSyncFailed';
      } else if (path === '/api/yazio/sync') {
        const sync: SyncStatus = await response.json();
        setStatus((current) => ({ ...current, sync }));
        const kind = syncResultKind(sync);
        outcome =
          kind === 'loaded'
            ? 'syncLoaded'
            : kind === 'photos-pending'
              ? 'syncPhotoWarning'
              : 'syncFailed';
      } else {
        setStatus((current) => ({
          ...current,
          configured: path === '/api/yazio/token',
        }));
        outcome = 'success';
      }
    } catch {
      outcome = path === '/api/yazio/sync' ? 'syncFailed' : 'failure';
    } finally {
      setPassword('');
      setToken('');
      await refreshStatus();
      setBusy(false);
      setResult(outcome);
    }
  }
  const startControl = (
    <>
      <TextInput
        readOnly={!online}
        label={messages.from}
        type="date"
        value={start}
        onChange={(event) => setFrom(event.currentTarget.value)}
        required
        onInvalid={(event) => {
          event.preventDefault();
          setPassword('');
          setResult('rangeInvalid');
        }}
        max={today || undefined}
        disabled={!online || !ready || busy}
      />
      <Text size="sm" c="dimmed">
        {messages.today}. {messages.rangeHelp}
      </Text>
    </>
  );
  const connectionForm = (
    <>
      <Text size="sm" c="dimmed">
        {messages.connectionHelp}
      </Text>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || busy || !status.tokenFileConfigured) {
            setPassword('');
            return;
          }
          const input = {
            email,
            password,
            ...connectionSchedule(),
          };
          setPassword('');
          void submit('/api/yazio/connect', input);
        }}
      >
        <Stack>
          <TextInput
            readOnly={!online}
            label={messages.email}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            required
            disabled={!online || !ready || busy || !status.tokenFileConfigured}
          />
          <PasswordInput
            readOnly={!online}
            label={messages.password}
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            visibilityToggleButtonProps={{
              'aria-label': messages.passwordVisibility,
            }}
            required
            disabled={!online || !ready || busy || !status.tokenFileConfigured}
          />
          {startControl}
          <Button
            type="submit"
            loading={busy}
            disabled={
              !ready || !status.tokenFileConfigured || !email || !password
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
      {!embedded && <Title order={1}>{messages.title}</Title>}
      <Stack component="section" id="connection" tabIndex={-1}>
        {!ready && <Text role="status">{messages.loading}</Text>}
        <Title order={2}>{messages.account}</Title>
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
                : ['connectionPhotoWarning', 'syncPhotoWarning'].includes(
                      result,
                    )
                  ? 'yellow'
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
        {!status.configured && connectionForm}
        {status.configured && (
          <Card withBorder>
            <Group wrap="nowrap">
              <Avatar
                src={status.account?.avatar}
                alt={messages.account}
                imageProps={{ referrerPolicy: 'no-referrer' }}
              >
                {'Y'}
              </Avatar>
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
                  {status.account?.name || messages.accountFallback}
                </Text>
                {status.account?.email && (
                  <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                    {status.account.email}
                  </Text>
                )}
                <Text size="sm" c="dimmed">
                  {messages.accountHelp}
                </Text>
              </Stack>
            </Group>
            <Button
              mt="sm"
              color="red"
              variant="light"
              disabled={!online || !ready || busy}
              onClick={() => setDisconnectOpen(true)}
            >
              {messages.disconnect}
            </Button>
          </Card>
        )}
        <Modal
          opened={disconnectOpen}
          onClose={() => setDisconnectOpen(false)}
          title={messages.disconnectTitle}
        >
          <Stack>
            <Text>{messages.disconnectHelp}</Text>
            <Group>
              <Button
                variant="default"
                onClick={() => setDisconnectOpen(false)}
              >
                {messages.cancel}
              </Button>
              <Button
                color="red"
                disabled={!online}
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
      </Stack>
      <Stack component="section" id="sync" tabIndex={-1}>
        <Title order={2}>{messages.syncTitle}</Title>
        {status.configured && startControl}
        {status.configured && (
          <Button
            disabled={!online || !ready || busy}
            loading={busy}
            onClick={() => void submit('/api/yazio/sync', periodRequest())}
          >
            {messages.recent}
          </Button>
        )}
        <Accordion onChange={() => setToken('')}>
          <Accordion.Item value="token">
            <Accordion.Control>{messages.advanced}</Accordion.Control>
            <Accordion.Panel>
              <Stack>
                <Text size="sm" c="dimmed" mb="sm">
                  {messages.tokenHelp}
                </Text>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!ready || busy || !status.tokenFileConfigured) {
                      setToken('');
                      return;
                    }
                    try {
                      void submit('/api/yazio/token', {
                        token: JSON.parse(token),
                        ...connectionSchedule(),
                      });
                    } catch {
                      setToken('');
                      setResult('failure');
                    }
                  }}
                >
                  <Stack>
                    <Textarea
                      readOnly={!online}
                      label={messages.token}
                      value={token}
                      onChange={(event) => setToken(event.currentTarget.value)}
                      autoComplete="off"
                      spellCheck={false}
                      minRows={4}
                      required
                      disabled={
                        !online || !ready || busy || !status.tokenFileConfigured
                      }
                    />
                    <Button
                      type="submit"
                      loading={busy}
                      disabled={
                        !online ||
                        !ready ||
                        !status.tokenFileConfigured ||
                        !token
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
                      periodRequest(to || undefined),
                    );
                  }}
                >
                  <Stack>
                    <TextInput
                      readOnly={!online}
                      label={messages.to}
                      description={messages.today}
                      type="date"
                      value={to}
                      onChange={(event) => setTo(event.currentTarget.value)}
                      max={today || undefined}
                      disabled={!online || !ready || busy}
                    />
                    <Button
                      type="submit"
                      loading={busy}
                      disabled={!online || !ready || !status.configured}
                    >
                      {messages.period}
                    </Button>
                  </Stack>
                </form>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        {status.sync.photoFailedDates.length > 0 && (
          <Alert color="yellow" role="status">
            {messages.photoWarning} ({status.sync.photoFailedDates.length})
          </Alert>
        )}
        {status.configured && (
          <Stack gap="xs">
            <Text size="sm">
              {!status.schedule.enabled
                ? messages.scheduleDisabled
                : status.schedule.schedulerActive
                  ? messages.automatic
                  : messages.schedulerInactive}
            </Text>
            {status.schedule.running && (
              <Text role="status">{messages.scheduledLoading}</Text>
            )}
            <Text size="sm">
              {messages.lastSuccess}:{' '}
              {ready && status.schedule.lastSuccess
                ? new Date(status.schedule.lastSuccess).toLocaleString(
                    'ru-RU',
                    {
                      timeZone: timezone,
                    },
                  )
                : messages.noRuns}
            </Text>
            <Text size="sm">
              {messages.nextRun}:{' '}
              {ready &&
              status.schedule.schedulerActive &&
              status.schedule.nextRunAt
                ? new Date(status.schedule.nextRunAt).toLocaleString('ru-RU', {
                    timeZone: timezone,
                  })
                : messages.pendingRun}
            </Text>
            {status.schedule.lastError && (
              <Alert color="yellow" role="status">
                {messages.scheduleErrors[status.schedule.lastError]}
              </Alert>
            )}
          </Stack>
        )}
        <Text role="status">
          {messages.foodStatus}:{' '}
          {status.sync.state === 'partial' &&
          status.sync.failedDates.length === 0 &&
          (status.sync.completedDates.length > 0 ||
            status.sync.skippedDates.length > 0)
            ? messages.states.completed
            : messages.states[status.sync.state]}{' '}
          {status.sync.completedDates.length + status.sync.failedDates.length >
            0 && (
            <>
              ({status.sync.completedDates.length}/
              {status.sync.completedDates.length +
                status.sync.failedDates.length}
              )
            </>
          )}
        </Text>
        {status.sync.skippedDates.length > 0 && (
          <Text size="sm">
            {messages.skipped}: {status.sync.skippedDates.length}
          </Text>
        )}
      </Stack>
    </Stack>
  );
}
