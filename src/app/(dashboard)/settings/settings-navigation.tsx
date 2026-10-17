'use client';

import { type ReactNode } from 'react';
import { SectionNavigation } from '@/components/shared/section-navigation';
import { stepsGoalMessages } from '@/contracts/steps-goal';
import { ru } from '@/config/messages';
import { transformMateConnectionMessages } from '@/contracts/transformmate-connection';
import classes from './settings.module.css';
import { offlineMessages } from '@/config/offline';

const sections = [
  { id: 'appearance', label: ru.appearance.title },
  { id: 'connection', label: ru.yazioSettings },
  { id: 'sync', label: ru.settings.syncTitle },
  { id: 'transformmate', label: transformMateConnectionMessages.title },
  { id: 'trainers', label: ru.trainerSettings },
  { id: 'steps-goal', label: stepsGoalMessages.title },
  { id: 'offline', label: offlineMessages.downloads.title },
];

export function SettingsNavigation({ children }: { children: ReactNode }) {
  return (
    <SectionNavigation sections={sections} label={ru.settings.navigation}>
      <div className={classes.content}>{children}</div>
    </SectionNavigation>
  );
}
