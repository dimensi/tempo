'use client';
import { useReadContext } from '@/lib/client-session';
import { SettingsReadView } from './read-view';
export function SettingsPage() {
  const context = useReadContext();
  return (
    <SettingsReadView
      ownerId={context.ownerId}
      owner={context.role === 'OWNER'}
    />
  );
}
