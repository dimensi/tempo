import {
  Badge,
  Container,
  Paper,
  Stack,
  Text,
  Title,
  ThemeIcon,
} from '@mantine/core';
import { IconLeaf } from '@tabler/icons-react';
export function SectionPlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Container size="lg" px={0}>
      <Stack gap="xl">
        <Stack gap="xs">
          <Text c="teal" size="sm" fw={700}>
            ПИТАНИЕ И ДВИЖЕНИЕ
          </Text>
          <Title order={1}>{title}</Title>
          <Text c="dimmed">{description}</Text>
        </Stack>
        <Paper withBorder p={{ base: 'lg', sm: 48 }} radius="lg">
          <Stack align="center" gap="md" ta="center">
            <ThemeIcon size={64} radius="xl" variant="light">
              <IconLeaf size={32} aria-hidden />
            </ThemeIcon>
            <Badge variant="light">Скоро здесь</Badge>
            <Title order={2} size="h3">
              Место для ваших данных
            </Title>
            <Text c="dimmed" maw={440}>
              Раздел готов к следующему этапу. Когда функция появится, ваши
              записи будут доступны здесь.
            </Text>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
