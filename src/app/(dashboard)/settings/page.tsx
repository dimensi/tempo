import { headers } from 'next/headers';
import { Stack, Text, Title } from '@mantine/core';
import { requireSession } from '@/server/auth/guards';
import { getYazioStatus } from '@/server/yazio/settings';
import { listTrainers } from '@/server/access/trainers';
import { TrainerSettings } from '@/features/trainer';
import { ru } from '@/config/messages';
import { YazioSettingsForm } from './yazio/settings-form';
import { SettingsNavigation } from './settings-navigation';

export const metadata = { title: 'Настройки' };
export default async function Page() {
  const session = await requireSession();
  if (session.user.role !== 'OWNER')
    return (
      <Stack>
        <Title order={1}>{ru.sections[6]!.title}</Title>
        <Text c="dimmed">{ru.settings.ownerOnly}</Text>
      </Stack>
    );
  const requestHeaders = await headers();
  const [status, trainers] = await Promise.all([
    getYazioStatus(requestHeaders),
    listTrainers(requestHeaders, session.user.id),
  ]);
  return (
    <Stack gap="xl" maw={960}>
      <Stack gap="xs">
        <Title order={1}>{ru.sections[6]!.title}</Title>
        <Text c="dimmed">{ru.settings.description}</Text>
      </Stack>
      <SettingsNavigation>
        <Stack gap={48}>
          <YazioSettingsForm initial={status} />
          <section id="trainers" tabIndex={-1} aria-label={ru.trainerSettings}>
            <TrainerSettings
              ownerId={session.user.id}
              initialTrainers={trainers}
              headingOrder={2}
            />
          </section>
        </Stack>
      </SettingsNavigation>
    </Stack>
  );
}
