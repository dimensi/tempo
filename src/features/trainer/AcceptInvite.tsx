'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Button,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { trainerMessages as m } from './messages';
export function AcceptInvite() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [accepted, setAccepted] = useState(false);
  async function accept() {
    setBusy(true);
    setError(false);
    try {
      const token = window.location.hash.slice(1);
      const response = await fetch('/api/trainers/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      });
      if (!response.ok) throw new Error();
      window.history.replaceState(null, '', '/invite');
      setPassword('');
      setAccepted(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack maw={480} mx="auto" p="md">
      <Title order={1}>{m.inviteTitle}</Title>
      {error && (
        <Alert color="red" role="alert">
          {m.error}
        </Alert>
      )}
      {accepted ? (
        <>
          <Alert>{m.accepted}</Alert>
          <Anchor component={Link} href="/login">
            {m.login}
          </Anchor>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void accept();
          }}
        >
          <Stack>
            <TextInput
              label={m.name}
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <PasswordInput
              label={m.password}
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Button mih={44} type="submit" loading={busy}>
              {m.accept}
            </Button>
          </Stack>
        </form>
      )}
    </Stack>
  );
}
