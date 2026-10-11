'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, PasswordInput, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { authClient } from '@/lib/auth-client';
import { ru } from '@/config/messages';
export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
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
      const result = await authClient.signIn.email(values);
      if (result.error) {
        setError(true);
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={form.onSubmit(submit)}>
      <Stack>
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
