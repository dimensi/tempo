'use client';
import { ReplicaStatus } from './replica-status';
import { replicaMessages } from '@/contracts/transformmate-replica';
import {
  transformMateConnectionMessages as m,
  transformMateCredentialsSchema,
  type TransformMateConnectionStatus,
} from '@/contracts/transformmate-connection';
import { apiFetch } from '@/lib/api-client';
import { apiResults } from '@/lib/api-results';
import { networkReachable } from '@/lib/network-state';
import { refreshAfterMutation } from '@/lib/provider-mutation';
import { useReadOnline } from '@/lib/use-read-online';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';

const copy = {
  cancel: 'Отмена',
  close: 'Закрыть',
  confirmDisconnect: 'Отключить TransformMate?',
  disconnectHint:
    'Планы и сохранённые результаты останутся в дашборде. Для отправки новых тренировок потребуется подключить аккаунт заново.',
  keyVisibility: 'Показать или скрыть API key',
  tokenVisibility: 'Показать или скрыть refresh token',
};

export function TransformMateSettingsForm({
  initial,
}: {
  initial: TransformMateConnectionStatus;
  embedded?: boolean;
}) {
  const online = useReadOnline();
  const [status, setStatus] = useState(initial);
  const [apiKey, setApiKey] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const inflight = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const clearCredentials = useCallback(() => {
    setApiKey('');
    setRefreshToken('');
  }, []);

  const request = useCallback(
    async (
      action: 'status' | 'connect' | 'check' | 'disconnect',
      body?: unknown,
    ) => {
      if (!navigator.onLine || !networkReachable()) return;
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      const mutation = action === 'connect' || action === 'disconnect';
      const current = () =>
        mounted.current &&
        inflight.current === controller &&
        !controller.signal.aborted;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const request = () =>
          apiFetch(`/api/transformmate/${action}`, {
            method: action === 'status' ? 'GET' : 'POST',
            cache: 'no-store',
            // Cancellation fences UI updates; a mutation must settle before final cache purge.
            ...(mutation ? { keepalive: true } : { signal: controller.signal }),
            ...(action === 'status'
              ? {}
              : {
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body ?? {}),
                }),
          });
        const response = mutation
          ? await refreshAfterMutation(request)
          : await request();
        const result: unknown = await response.json();
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            if (current()) {
              setDenied(true);
              setStatus({
                configured: false,
                account: null,
                checkedAt: null,
                errorCode: null,
              });
            }
            throw new Error(m.noAccess);
          }
          const code =
            typeof result === 'object' &&
            result !== null &&
            'errorCode' in result
              ? result.errorCode
              : null;
          const known = apiResults.connectionError(code);
          if (known.success && known.data && current())
            setStatus((current) => ({ ...current, errorCode: known.data }));
          throw new Error(
            known.success && known.data ? m[known.data] : m.requestError,
          );
        }
        const parsed = apiResults.connection(
          typeof result === 'object' && result !== null && 'data' in result
            ? result.data
            : null,
        );
        if (current()) {
          setStatus(parsed);
          setDenied(false);
          if (action === 'connect') setNotice(m.saved);
          if (action === 'disconnect') {
            setNotice(m.removed);
            setDisconnectOpen(false);
          }
        }
      } catch (failure) {
        if (current())
          setError(
            failure instanceof Error &&
              Object.values(m).includes(
                failure.message as (typeof m)[keyof typeof m],
              )
              ? failure.message
              : m.requestError,
          );
      } finally {
        if (current()) {
          if (mutation) clearCredentials();
          setBusy(false);
          inflight.current = null;
        }
      }
    },
    [clearCredentials],
  );
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => {
      if (mounted.current) void request('status');
    });
    return () => {
      mounted.current = false;
      inflight.current?.abort();
      inflight.current = null;
    };
  }, [request]);
  return (
    <Stack
      component="section"
      id="transformmate"
      tabIndex={-1}
      maw={600}
      style={{ minWidth: 0, overflowWrap: 'anywhere' }}
    >
      <Group justify="space-between" gap="sm">
        <Title order={2}>{m.title}</Title>
        <Badge variant="light" color={status.configured ? 'teal' : 'gray'}>
          {status.configured ? m.connected : m.disconnected}
        </Badge>
      </Group>
      {(error || status.errorCode) && (
        <Alert color="red" role="alert">
          {error ?? (status.errorCode ? m[status.errorCode] : '')}
        </Alert>
      )}
      {notice && (
        <Alert color="teal" role="status">
          {notice}
        </Alert>
      )}
      {!denied && <ReplicaStatus configured={status.configured} />}
      {!denied && status.configured && (
        <Accordion variant="default">
          <Accordion.Item value="connection">
            <Accordion.Control mih={44}>
              {replicaMessages.reconnect}
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <Text fw={600}>{status.account?.name ?? m.unknownAccount}</Text>
                {status.account?.email && <Text>{status.account.email}</Text>}
                {status.account && (
                  <Text size="sm">
                    {m.account}: {status.account.id}
                  </Text>
                )}
                <Text size="sm">
                  {m.checked}:{' '}
                  {status.checkedAt
                    ? new Date(status.checkedAt).toLocaleString('ru-RU')
                    : '—'}
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <Button
                    mih={44}
                    variant="light"
                    loading={busy}
                    disabled={!online}
                    onClick={() => void request('check')}
                  >
                    {m.check}
                  </Button>
                  <Button
                    mih={44}
                    variant="default"
                    disabled={!online || busy}
                    onClick={() => setDisconnectOpen(true)}
                  >
                    {m.disconnect}
                  </Button>
                </SimpleGrid>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
      {!denied &&
        (!status.configured || status.errorCode === 'reauth_required') && (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              const parsed = transformMateCredentialsSchema.safeParse({
                apiKey,
                refreshToken,
              });
              clearCredentials();
              if (!parsed.success) {
                setError(m.invalid);
                setNotice(null);
                return;
              }
              void request('connect', parsed.data);
            }}
          >
            <Stack>
              <Text size="sm">{m.credentialsHint}</Text>
              <PasswordInput
                readOnly={!online}
                label={m.apiKey}
                autoComplete="off"
                visibilityToggleButtonProps={{
                  'aria-label': copy.keyVisibility,
                }}
                visibilityToggleFocusable
                styles={{
                  input: { minHeight: 44 },
                  visibilityToggle: { minWidth: 44, minHeight: 44 },
                }}
                value={apiKey}
                maxLength={512}
                required
                disabled={!online || busy}
                onChange={(event) => setApiKey(event.currentTarget.value)}
              />
              <PasswordInput
                readOnly={!online}
                label={m.refreshToken}
                autoComplete="off"
                visibilityToggleButtonProps={{
                  'aria-label': copy.tokenVisibility,
                }}
                visibilityToggleFocusable
                styles={{
                  input: { minHeight: 44 },
                  visibilityToggle: { minWidth: 44, minHeight: 44 },
                }}
                value={refreshToken}
                maxLength={8192}
                required
                disabled={!online || busy}
                onChange={(event) => setRefreshToken(event.currentTarget.value)}
              />
              <Button type="submit" mih={44} loading={busy} disabled={!online}>
                {status.configured ? m.reconnect : m.connect}
              </Button>
            </Stack>
          </form>
        )}
      <Modal
        opened={disconnectOpen}
        onClose={() => {
          if (!busy) setDisconnectOpen(false);
        }}
        title={copy.confirmDisconnect}
        closeOnEscape={!busy}
        closeOnClickOutside={!busy}
        withCloseButton={!busy}
        closeButtonProps={{ 'aria-label': copy.close, size: 44 }}
      >
        <Stack>
          <Text>{copy.disconnectHint}</Text>
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Group grow>
            <Button
              mih={44}
              variant="default"
              disabled={!online || busy}
              onClick={() => setDisconnectOpen(false)}
            >
              {copy.cancel}
            </Button>
            <Button
              mih={44}
              color="red"
              loading={busy}
              disabled={!online}
              onClick={() => void request('disconnect')}
            >
              {m.disconnect}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
