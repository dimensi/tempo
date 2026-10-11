'use client';
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { TrainerDto } from '@/contracts/trainers';
import { trainerMessages as m } from './messages';
export function TrainerSettings({
  ownerId,
  initialTrainers,
  headingOrder = 1,
}: {
  ownerId: string;
  initialTrainers: TrainerDto[];
  headingOrder?: 1 | 2;
}) {
  const [trainers, setTrainers] = useState(initialTrainers);
  const [email, setEmail] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function invite() {
    setBusy(true);
    setError(false);
    setUrl('');
    try {
      const response = await fetch('/api/trainers/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, email }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      setUrl(`${window.location.origin}/invite#${result.token}`);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function grant(trainer: TrainerDto) {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch('/api/trainers', {
        method: trainer.granted ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, trainerId: trainer.id }),
      });
      if (!response.ok) throw new Error();
      setTrainers((rows) =>
        rows.map((row) =>
          row.id === trainer.id ? { ...row, granted: !row.granted } : row,
        ),
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <Title order={headingOrder}>{m.title}</Title>
      {error && (
        <Alert color="red" role="alert">
          {m.error}
        </Alert>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <Stack>
          <TextInput
            type="email"
            label={m.email}
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
          />
          <Button mih={44} type="submit" loading={busy}>
            {m.invite}
          </Button>
        </Stack>
      </form>
      {url && <TextInput label={m.copy} value={url} readOnly />}
      {trainers.map((trainer) => (
        <Group key={trainer.id} justify="space-between" wrap="wrap">
          <Text>
            {trainer.name} ({trainer.email})
          </Text>
          <Button mih={44} disabled={busy} onClick={() => void grant(trainer)}>
            {trainer.granted ? m.revoke : m.grant}
          </Button>
        </Group>
      ))}
    </Stack>
  );
}
