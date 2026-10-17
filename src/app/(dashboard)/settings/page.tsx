'use client';
import { PageHeader } from '@/components/layout/page-header';
import { ru } from '@/config/messages';
import { useReadContext } from '@/lib/client-session';
import { AccessPanel } from '@/features/anamnesis';
import { OfflineSettings } from '@/features/offline';
import { TrainerSettings } from '@/features/trainer';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { Skeleton, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { AppearanceSettings } from './appearance';
import { SettingsNavigation } from './settings-navigation';
import { StepsGoalForm } from './steps-goal-form';
import { TransformMateSettingsForm } from './transformmate/settings-form';
import { YazioSettingsForm } from './yazio/settings-form';
export default function Page() {
  const context = useReadContext();
  const ownerId = context.ownerId;
  const owner = context.role === 'OWNER';
  const resource = useReadResource(
    readResources.settings(owner ? '/api/read/settings' : undefined),
  );
  const [retained, setRetained] = useState(resource.data);
  if (resource.data && resource.data !== retained) setRetained(resource.data);
  if (!owner || !ownerId)
    return (
      <Stack gap="xl">
        <PageHeader>
          {ru.sections.find((section) => section.href === '/settings')!.title}
        </PageHeader>
        <AppearanceSettings />
      </Stack>
    );
  const data = resource.data ?? retained;

  return (
    <Stack gap="xl">
      <Stack gap="xs">
        <PageHeader>
          {ru.sections.find((section) => section.href === '/settings')!.title}
        </PageHeader>
        <Text c="dimmed">{ru.settings.description}</Text>
      </Stack>
      <SettingsNavigation contentReady={!!data}>
        <Stack gap={48}>
          <AppearanceSettings />
          {!data ? (
            <Skeleton height={180} />
          ) : (
            <>
              <YazioSettingsForm initial={data.yazio} embedded />
              <TransformMateSettingsForm
                initial={data.transformMate}
                embedded
              />
              <section
                id="trainers"
                tabIndex={-1}
                aria-label={ru.trainerSettings}
              >
                <Stack gap="xl">
                  <TrainerSettings
                    ownerId={ownerId}
                    initialTrainers={data.trainers}
                    headingOrder={2}
                  />
                  <AccessPanel ownerId={ownerId} />
                </Stack>
              </section>
              <StepsGoalForm initial={data.stepsGoal} />
              <OfflineSettings />
            </>
          )}
        </Stack>
      </SettingsNavigation>
    </Stack>
  );
}
