import { getStepsGoal } from '@/server/settings/steps-goal';
import { StepsGoalForm } from './steps-goal-form';
import { headers } from 'next/headers';
import { Stack, Text, Title } from '@mantine/core';
import { requireSession } from '@/server/auth/guards';
import { getYazioStatus } from '@/server/yazio/settings';
import { getTransformMateStatus } from '@/server/transformmate/connection';
import { listTrainers } from '@/server/access/trainers';
import { TrainerSettings } from '@/features/trainer';
import { ru } from '@/config/messages';
import { YazioSettingsForm } from './yazio/settings-form';
import { TransformMateSettingsForm } from './transformmate/settings-form';
import { SettingsNavigation } from './settings-navigation';
import { AccessPanel } from '@/features/anamnesis';
import { OfflineSettings } from '@/features/offline';

export const metadata = { title: 'Настройки' };
export default async function Page() {
  const session = await requireSession();
  if (session.user.role !== 'OWNER')
    return (
      <Stack>
        <Title order={1}>
          {ru.sections.find((section) => section.href === '/settings')!.title}
        </Title>
        <Text c="dimmed">{ru.settings.ownerOnly}</Text>
      </Stack>
    );
  const requestHeaders = await headers();
  const [status, transformMateStatus, trainers, stepsGoal] = await Promise.all([
    getYazioStatus(requestHeaders),
    getTransformMateStatus(requestHeaders),
    listTrainers(requestHeaders, session.user.id),
    getStepsGoal(requestHeaders),
  ]);
  return (
    <Stack gap="xl">
      <Stack gap="xs">
        <Title order={1}>
          {ru.sections.find((section) => section.href === '/settings')!.title}
        </Title>
        <Text c="dimmed">{ru.settings.description}</Text>
      </Stack>
      <SettingsNavigation>
        <Stack gap={48}>
          <YazioSettingsForm initial={status} embedded />
          <TransformMateSettingsForm initial={transformMateStatus} embedded />
          <section id="trainers" tabIndex={-1} aria-label={ru.trainerSettings}>
            <TrainerSettings
              ownerId={session.user.id}
              initialTrainers={trainers}
              headingOrder={2}
            />
            <AccessPanel ownerId={session.user.id} />
          </section>
          <StepsGoalForm initial={stepsGoal} />
          <OfflineSettings />
        </Stack>
      </SettingsNavigation>
    </Stack>
  );
}
