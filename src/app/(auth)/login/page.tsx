import { Container, Paper, Stack, Text, Title } from '@mantine/core';
import { LoginForm } from '@/components/shared/login-form';
export const metadata = { title: 'Вход' };
export default function LoginPage() {
  return (
    <Container size={440} py={80}>
      <Stack gap="xl">
        <Stack gap="xs">
          <Text c="teal" fw={700}>
            ПИТАНИЕ И ДВИЖЕНИЕ
          </Text>
          <Title order={1}>С возвращением</Title>
          <Text c="dimmed">Войдите, чтобы открыть своё пространство.</Text>
        </Stack>
        <Paper withBorder p="xl" radius="lg">
          <LoginForm />
        </Paper>
        <Text size="sm" c="dimmed">
          Доступ создаёт владелец. Открытая регистрация отключена.
        </Text>
      </Stack>
    </Container>
  );
}
