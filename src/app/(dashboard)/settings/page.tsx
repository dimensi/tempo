import Link from 'next/link';
import { Card, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { requireSession } from '@/server/auth/guards';
import { ru } from '@/config/messages';
export const metadata = { title: 'Настройки' };
export default async function Page() {
  const session = await requireSession();
  return (
    <Stack maw={800}>
      <Title order={1}>{ru.sections[6]!.title}</Title>
      {session.user.role === 'OWNER' ? (
        <>
          <Text c="dimmed">{ru.settings.description}</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {[
              {
                href: '/settings/yazio',
                title: ru.yazioSettings,
                description: ru.settings.yazioDescription,
              },
              {
                href: '/settings/trainers',
                title: ru.trainerSettings,
                description: ru.settings.trainersDescription,
              },
            ].map((section) => (
              <Link
                key={section.href}
                href={section.href}
                aria-label={section.title}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <Card withBorder radius="md" p="lg" h="100%">
                  <Title order={2} size="h3" mb="sm">
                    {section.title}
                  </Title>
                  <Text size="sm" c="dimmed">
                    {section.description}
                  </Text>
                </Card>
              </Link>
            ))}
          </SimpleGrid>
        </>
      ) : (
        <Text c="dimmed">{ru.settings.ownerOnly}</Text>
      )}
    </Stack>
  );
}
