'use client';
import { useState } from 'react';
import { ReadLink as Link } from '@/components/shared/read-link';
import {
  Alert,
  Anchor,
  Button,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { passwordLimits } from '@/contracts/password';
import {
  acceptInviteInput,
  acceptInviteErrorSchema,
  acceptInviteResponseSchema,
} from '@/contracts/trainers';
import { trainerMessages as m } from './messages';
export function AcceptInvite() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  async function accept() {
    setError(null);
    setNameError(null);
    setPasswordError(null);
    const token = window.location.hash.slice(1);
    const parsed = acceptInviteInput.safeParse({ token, name, password });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'token') setError(m.invalidLink);
        if (issue.path[0] === 'name') setNameError(m.nameInvalid);
        if (issue.path[0] === 'password') setPasswordError(m.passwordInvalid);
      }
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/trainers/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = acceptInviteErrorSchema.safeParse(body);
        setError(
          response.status === 403
            ? m.originError
            : failure.success
              ? {
                  INVITE_INVALID_INPUT: m.invalidInput,
                  INVITE_UNAVAILABLE: m.invalidLink,
                  INVITE_ACCOUNT_EXISTS: m.accountExists,
                }[failure.data.error]
              : m.temporaryError,
        );
        return;
      }
      if (!acceptInviteResponseSchema.safeParse(body).success)
        throw new Error();
      window.history.replaceState(null, '', '/invite');
      setPassword('');
      setAccepted(true);
    } catch {
      setError(m.temporaryError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack maw={480} mx="auto" p="md">
      <Title order={1}>{m.inviteTitle}</Title>
      {error && (
        <Alert color="red" role="alert">
          {error}
          {(error === m.invalidLink || error === m.accountExists) && (
            <Anchor component={Link} href="/login">
              {m.login}
            </Anchor>
          )}
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
          noValidate
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
              error={nameError}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <PasswordInput
              label={m.password}
              required
              minLength={passwordLimits.min}
              maxLength={passwordLimits.max}
              description={m.passwordHelp}
              error={passwordError}
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
