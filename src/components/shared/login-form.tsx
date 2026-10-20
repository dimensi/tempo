'use client';
import { ru } from '@/config/messages';
import { exerciseReturnTo } from '@/lib/exercise-link';
import { authClient } from '@/lib/auth-client';
import { clearClientData, finishPendingLogout } from '@/lib/local-logout';
import { offlineDeviceMessages } from '@/lib/offline-device';
import { Alert, Button, PasswordInput, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useState } from 'react';
export function LoginForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [cleanupError, setCleanupError] = useState(false);
  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: (value) =>
        /^\S+@\S+\.\S+$/.test(value) ? null : 'Введите корректную почту',
      password: (value) => (value.length ? null : 'Введите пароль'),
    },
  });
  async function submit(values: typeof form.values) {
    setBusy(true);
    setError(false);
    try {
      if (!(await finishPendingLogout())) {
        setError(true);
        return;
      }
      await clearClientData().catch(() => setCleanupError(true));
      const result = await authClient.signIn.email(values);
      if (result.error) {
        setError(true);
        return;
      }
      const target =
        exerciseReturnTo(
          new URLSearchParams(location.search).get('returnTo'),
        ) ??
        exerciseReturnTo(location.pathname) ??
        '/';
      location.replace(target);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={form.onSubmit(submit)}>
      <Stack>
        {cleanupError && (
          <Alert color="orange" role="status">
            {offlineDeviceMessages.cleanupWarning}
          </Alert>
        )}
        {error && (
          <Alert color="red" role="alert">
            {ru.loginError}
          </Alert>
        )}
        <TextInput
          label={ru.email}
          type="email"
          autoComplete="username"
          required
          {...form.getInputProps('email')}
        />
        <PasswordInput
          label={ru.password}
          visibilityToggleButtonProps={{
            'aria-label': 'Показать или скрыть пароль',
          }}
          autoComplete="current-password"
          required
          {...form.getInputProps('password')}
        />
        <Button type="submit" loading={busy} fullWidth>
          {ru.login}
        </Button>
      </Stack>
    </form>
  );
}
