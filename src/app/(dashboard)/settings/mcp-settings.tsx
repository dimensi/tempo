'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  CopyButton,
  Group,
  List,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { z } from 'zod';
import { mcpMessages as m } from '@/config/mcp-messages';
import {
  mcpClientCredentials,
  mcpClientInput,
  mcpClientList,
} from '@/contracts/mcp-clients';
import { apiFetch } from '@/lib/api-client';
import { apiResults } from '@/lib/api-results';
import { useReadOnline } from '@/lib/use-read-online';

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap="xs">
      <TextInput
        label={label}
        value={value}
        readOnly
        styles={{ input: { fontSize: 16 } }}
      />
      <CopyButton value={value}>
        {({ copied, copy }) => (
          <Button
            variant="light"
            onClick={copy}
            style={{ alignSelf: 'flex-start' }}
          >
            {copied ? m.copied : m.copy}
          </Button>
        )}
      </CopyButton>
    </Stack>
  );
}

export function McpSettings() {
  const online = useReadOnline();
  const [data, setData] = useState<z.infer<typeof mcpClientList> | null>(null);
  const [credentials, setCredentials] = useState<z.infer<
    typeof mcpClientCredentials
  > | null>(null);
  const [name, setName] = useState('ChatGPT');
  const [callback, setCallback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch('/api/settings/mcp', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = apiResults.mcpClients(await response.json());
        if (!controller.signal.aborted) {
          setData(result);
          setError(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(m.loadError);
      });
    return () => controller.abort();
  }, [revision]);
  async function mutate(method: 'POST' | 'DELETE', body: unknown) {
    setPending(true);
    setError(null);
    try {
      const response = await apiFetch('/api/settings/mcp', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      if (!response.ok) {
        setError(response.status === 429 ? m.limitError : m.operationError);
        return;
      }
      if (method === 'POST')
        setCredentials(apiResults.mcpCredentials(await response.json()));
      setConfirm(null);
      setRevision((value) => value + 1);
    } catch {
      setError(m.operationError);
    } finally {
      setPending(false);
    }
  }
  return (
    <section id="mcp" tabIndex={-1} aria-labelledby="mcp-title">
      <Stack gap="lg" maw={680}>
        <Stack gap="xs">
          <Title id="mcp-title" order={2}>
            {m.settingsTitle}
          </Title>
          <Text c="dimmed">{m.description}</Text>
        </Stack>
        {data && <CopyField label={m.endpoint} value={data.endpoint} />}
        <Stack gap="xs">
          <Title order={3}>{m.setup}</Title>
          <List type="ordered" spacing="sm">
            {m.instructions.map((text) => (
              <List.Item key={text}>{text}</List.Item>
            ))}
          </List>
          <Text size="sm" c="dimmed">
            {m.compatibility}
          </Text>
        </Stack>
        {error && (
          <Alert color="red" role="alert">
            {error}
            <Button
              variant="subtle"
              onClick={() => setRevision((value) => value + 1)}
            >
              {m.retry}
            </Button>
          </Alert>
        )}
        {!online && <Text size="sm">{m.offline}</Text>}
        {credentials ? (
          <Paper withBorder p="md">
            <Stack gap="md">
              <Text fw={600}>{m.once}</Text>
              <CopyField label={m.clientId} value={credentials.client_id} />
              <CopyField label={m.secret} value={credentials.client_secret} />
              <Button variant="light" onClick={() => setCredentials(null)}>
                {m.closeSecret}
              </Button>
            </Stack>
          </Paper>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = mcpClientInput.safeParse({ name, callback });
              if (!parsed.success) {
                setError(m.operationError);
                return;
              }
              void mutate('POST', parsed.data);
            }}
          >
            <Stack gap="md">
              <TextInput
                label={m.name}
                value={name}
                maxLength={80}
                required
                disabled={pending}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <TextInput
                label={m.callback}
                description={m.callbackHelp}
                value={callback}
                maxLength={2048}
                type="url"
                required
                disabled={pending}
                onChange={(event) => setCallback(event.currentTarget.value)}
              />
              <Button
                type="submit"
                loading={pending}
                disabled={!online || !data}
                style={{ alignSelf: 'flex-start' }}
              >
                {m.create}
              </Button>
            </Stack>
          </form>
        )}
        {data && (
          <Stack gap="md">
            {data.clients.length === 0 && <Text c="dimmed">{m.empty}</Text>}
            {data.clients.map((client) => (
              <Stack key={client.clientId} gap="xs">
                <Group justify="space-between">
                  <Text fw={600}>{client.name}</Text>
                  <Badge color={client.disabled ? 'gray' : 'teal'}>
                    {client.disabled ? m.revoked : m.active}
                  </Badge>
                </Group>
                <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                  {client.callback}
                </Text>
                <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                  {m.clientId}: {client.clientId}
                </Text>
                {!client.disabled && (
                  <Group>
                    {confirm === client.clientId ? (
                      <>
                        <Button
                          color="red"
                          loading={pending}
                          disabled={!online}
                          onClick={() =>
                            void mutate('DELETE', { clientId: client.clientId })
                          }
                        >
                          {m.confirmRevoke}
                        </Button>
                        <Button
                          variant="subtle"
                          disabled={pending}
                          onClick={() => setConfirm(null)}
                        >
                          {m.cancel}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="light"
                        color="red"
                        disabled={!online || pending}
                        onClick={() => setConfirm(client.clientId)}
                      >
                        {m.revoke}
                      </Button>
                    )}
                  </Group>
                )}
              </Stack>
            ))}
          </Stack>
        )}
        <Text size="sm" c="dimmed">
          {m.lifetime}
        </Text>
      </Stack>
    </section>
  );
}
