import { Container, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { LoginForm } from '@/components/shared/login-form';
import { BrandMark } from '@/components/branding/brand-mark';
import { ru } from '@/config/messages';
export const metadata = { title: 'Вход' };
export default function LoginPage() {
  return (
    <Container size={440} py={80}>
      <Stack gap="xl">
        <Stack gap="xs">
          <Group gap="sm" wrap="nowrap" mb="sm">
            <BrandMark size={44} />
            <Text fw={700}>{ru.appName}</Text>
          </Group>
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
