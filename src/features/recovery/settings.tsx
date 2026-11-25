'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  healthAutoExportStatusSchema,
  healthAutoExportTokenSchema,
  type HealthAutoExportStatus,
} from '@/contracts/health-auto-export';
import { apiFetch } from '@/lib/api-client';
import { sessionGeneration } from '@/lib/session-state';
import { useReadOnline } from '@/lib/use-read-online';
import { healthAutoExportMessages as m } from './messages';
import classes from './recovery.module.css';

const settingsEndpoint = '/api/settings/health-auto-export';
const dateTime = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatTime(value: string | null) {
  return value ? dateTime.format(new Date(value)) : m.noAttempt;
}

function CopyField({
  label,
  value,
  copy,
}: {
  label: string;
  value: string;
  copy: string;
}) {
  return (
    <Stack gap="xs">
      <TextInput
        label={label}
        value={value}
        readOnly
        size="md"
        autoComplete="off"
        spellCheck={false}
      />
      <CopyButton value={value}>
        {({ copied, copy: copyValue }) => (
          <Button
            variant="light"
            onClick={copyValue}
            style={{ alignSelf: 'flex-start' }}
            mih={44}
          >
            {copied ? m.copied : copy}
          </Button>
        )}
      </CopyButton>
    </Stack>
  );
}

function SyncDetails({ status }: { status: HealthAutoExportStatus }) {
  const details = [
    { label: m.lastSuccess, value: formatTime(status.lastSuccessAt) },
    { label: m.lastAttempt, value: formatTime(status.lastAttemptAt) },
    {
      label: m.records,
      value: status.lastSuccessAt ? status.lastInserted : null,
    },
    {
      label: m.lastError,
      value: status.lastErrorCode ? m.errors[status.lastErrorCode] : m.noError,
      error: !!status.lastErrorCode,
    },
  ];
  return (
    <Stack component="dl" m={0} gap="xs" aria-live="polite">
      {details.map(({ label, value, error }) =>
        value !== null ? (
          <Group key={label} justify="space-between" align="baseline" gap="xs">
            <Text component="dt" size="sm">
              {label}
            </Text>
            <Text
              component="dd"
              size="sm"
              m={0}
              c={error ? 'red' : undefined}
              className={classes.value}
            >
              {value}
            </Text>
          </Group>
        ) : null,
      )}
    </Stack>
  );
}

export function HealthAutoExportSettings() {
  const online = useReadOnline();
  const [status, setStatus] = useState<HealthAutoExportStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<'POST' | 'DELETE' | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const generation = sessionGeneration();
    const current = () =>
      !controller.signal.aborted && generation === sessionGeneration();
    void (async () => {
      try {
        const response = await apiFetch(settingsEndpoint, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error();
        const data = healthAutoExportStatusSchema.parse(await response.json());
        if (current()) {
          setStatus(data);
          setLoadError(false);
        }
      } catch {
        if (current()) setLoadError(true);
      } finally {
        if (current()) setRefreshing(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);

  async function mutate(method: 'POST' | 'DELETE') {
    const generation = sessionGeneration();
    setPending(true);
    setOperationError(null);
    try {
      const response = await apiFetch(settingsEndpoint, {
        method,
        cache: 'no-store',
      });
      const value: unknown = await response.json();
      if (generation !== sessionGeneration()) return;
      if (!response.ok) {
        setOperationError(
          response.status === 409 ? m.insecure : m.operationError,
        );
        return;
      }
      if (method === 'POST') {
        const result = healthAutoExportTokenSchema.parse(value);
        setToken(result.token);
        setStatus(result.status);
      } else {
        setStatus(healthAutoExportStatusSchema.parse(value));
        setToken(null);
      }
      setConfirm(null);
      setRevision((value) => value + 1);
    } catch {
      if (generation === sessionGeneration())
        setOperationError(m.operationError);
    } finally {
      if (generation === sessionGeneration()) setPending(false);
    }
  }

  return (
    <section
      id="apple-health"
      tabIndex={-1}
      aria-labelledby="apple-health-title"
    >
      <Stack gap="lg" maw={680}>
        <Stack gap="xs">
          <Title id="apple-health-title" order={2}>
            {m.title}
          </Title>
          <Text>{m.description}</Text>
        </Stack>
        {loadError && (
          <Alert color="red" role="alert">
            {m.loadError}
          </Alert>
        )}
        {!status && !loadError && <Skeleton height={85} />}
        {status && (
          <>
            {status.endpoint ? (
              <>
                <CopyField
                  label={m.endpoint}
                  value={status.endpoint}
                  copy={m.copyUrl}
                />
                <Text size="sm">{m.connectHelp}</Text>
              </>
            ) : (
              <Alert color="orange">{m.insecure}</Alert>
            )}
            <Badge color={status.connected ? 'teal' : 'gray'} variant="light">
              {status.connected ? m.tokenActive : m.noToken}
            </Badge>
          </>
        )}
        {operationError && (
          <Alert color="red" role="alert">
            {operationError}
          </Alert>
        )}
        {token && (
          <Paper withBorder p="md">
            <Stack gap="sm">
              <Text>{m.once}</Text>
              <CopyField label={m.token} value={token} copy={m.copyToken} />
              <Text size="sm">
                {m.authorizationHeader} · <Code>Bearer &lt;токен&gt;</Code>
              </Text>
              <Button
                variant="light"
                onClick={() => setToken(null)}
                mih={44}
                style={{ alignSelf: 'flex-start' }}
              >
                {m.tokenSaved}
              </Button>
            </Stack>
          </Paper>
        )}
        {!token &&
          status &&
          (confirm ? (
            <Stack gap="xs">
              <Text size="sm">
                {confirm === 'POST' ? m.rotatePrompt : m.revokePrompt}
              </Text>
              <Group gap="sm">
                <Button
                  color={confirm === 'DELETE' ? 'red' : undefined}
                  loading={pending}
                  disabled={!online}
                  mih={44}
                  onClick={() => void mutate(confirm)}
                >
                  {confirm === 'POST' ? m.confirmRotate : m.confirmRevoke}
                </Button>
                <Button
                  variant="subtle"
                  disabled={pending}
                  mih={44}
                  onClick={() => setConfirm(null)}
                >
                  {m.cancel}
                </Button>
              </Group>
            </Stack>
          ) : (
            <Group gap="sm">
              {status.endpoint && (
                <Button
                  loading={pending}
                  disabled={!online}
                  mih={44}
                  variant={status.connected ? 'light' : 'filled'}
                  onClick={() =>
                    status.connected ? setConfirm('POST') : void mutate('POST')
                  }
                >
                  {status.connected ? m.rotate : m.create}
                </Button>
              )}
              {status.connected && (
                <Button
                  variant="subtle"
                  color="red"
                  disabled={!online || pending}
                  mih={44}
                  onClick={() => setConfirm('DELETE')}
                >
                  {m.revoke}
                </Button>
              )}
            </Group>
          ))}
        {!online && <Text size="sm">{m.offline}</Text>}
        {status && <SyncDetails status={status} />}
        {(status || loadError) && (
          <Button
            variant="subtle"
            disabled={!online || pending}
            loading={refreshing}
            mih={44}
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              setRefreshing(true);
              setRevision((value) => value + 1);
            }}
          >
            {m.refresh}
          </Button>
        )}
      </Stack>
    </section>
  );
}
