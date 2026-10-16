'use client';
import { ru } from '@/config/messages';
import { type ReadSettings } from '@/contracts/read-settings';
import { AccessPanel } from '@/features/anamnesis';
import { OfflineSettings } from '@/features/offline';
import { TrainerSettings } from '@/features/trainer';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { Skeleton, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { SettingsNavigation } from './settings-navigation';
import { StepsGoalForm } from './steps-goal-form';
import { TransformMateSettingsForm } from './transformmate/settings-form';
import { YazioSettingsForm } from './yazio/settings-form';
export function SettingsReadView({
  ownerId,
  owner,
  initial,
}: {
  ownerId: string | null;
  owner: boolean;
  initial?: ReadSettings;
}) {
  const resource = useReadResource(
    readResources.settings(owner ? '/api/read/settings' : undefined),
    initial,
  );
  const [retained, setRetained] = useState(resource.data);
  if (resource.data && resource.data !== retained) setRetained(resource.data);
  if (!owner || !ownerId)
    return (
      <Stack>
        <Title order={1}>
          {ru.sections.find((section) => section.href === '/settings')!.title}
        </Title>
        <Text>{ru.settings.ownerOnly}</Text>
      </Stack>
    );
  const data = resource.data ?? retained;
  if (!data) return <Skeleton height={180} />;
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
          <YazioSettingsForm initial={data.yazio} embedded />
          <TransformMateSettingsForm initial={data.transformMate} embedded />
          <section id="trainers" tabIndex={-1} aria-label={ru.trainerSettings}>
            <TrainerSettings
              ownerId={ownerId}
              initialTrainers={data.trainers}
              headingOrder={2}
            />
            <AccessPanel ownerId={ownerId} />
          </section>
          <StepsGoalForm initial={data.stepsGoal} />
          <OfflineSettings />
        </Stack>
      </SettingsNavigation>
    </Stack>
  );
}
