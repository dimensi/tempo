'use client';

import { useEffect, useState } from 'react';
import { Alert, Stack, Switch, Text, Title } from '@mantine/core';
import type { AnamnesisAccess } from '@/contracts/anamnesis';
import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import { fetchAnamnesis, ownerIdQuery } from './api';

export function AccessPanel({ ownerId }: { ownerId: string }) {
  const [access, setAccess] = useState<AnamnesisAccess>();
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const query = ownerIdQuery(ownerId);

  useEffect(() => {
    let active = true;
    void fetchAnamnesis<AnamnesisAccess>(`/api/anamnesis/access?${query}`)
      .then((value) => {
        if (active) setAccess(value);
      })
      .catch(() => {
        if (active) setError(m.errors.load);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query]);

  async function toggle(trainerId: string, enabled: boolean) {
    setError(undefined);
    setPending((ids) => [...ids, trainerId]);
    try {
      await fetchAnamnesis(`/api/anamnesis/access?${query}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainerId, enabled }),
      });
      setAccess((old) =>
        old
          ? {
              trainers: old.trainers.map((trainer) =>
                trainer.trainerId === trainerId
                  ? { ...trainer, enabled }
                  : trainer,
              ),
            }
          : old,
      );
    } catch {
      setError(m.errors.save);
    } finally {
      setPending((ids) => ids.filter((id) => id !== trainerId));
    }
  }

  return (
    <Stack data-testid="anamnesis-access">
      <Title order={3}>{m.access.title}</Title>
      <Text size="sm" c="dimmed">
        {m.access.description}
      </Text>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {loading && <Text>…</Text>}
      {!loading && !error && !access?.trainers.length && (
        <Text>{m.access.empty}</Text>
      )}
      {access?.trainers.map((trainer) => (
        <Switch
          key={trainer.trainerId}
          data-testid="anamnesis-access-trainer"
          label={trainer.name}
          description={m.access.scope}
          size="md"
          checked={trainer.enabled}
          disabled={pending.includes(trainer.trainerId)}
          onChange={(event) =>
            void toggle(trainer.trainerId, event.currentTarget.checked)
          }
          styles={{
            root: { minHeight: 44 },
            body: { alignItems: 'center' },
            labelWrapper: { minWidth: 0 },
          }}
        />
      ))}
    </Stack>
  );
}
