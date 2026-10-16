'use client';
import { useReadLocation } from '@/lib/workspace-navigation';
import { OfflineWrites } from '@/features/offline';
export function DeviceWrites({ role }: { role: string }) {
  const path = new URL(useReadLocation() || '/', 'https://tempo.local')
    .pathname;
  return role === 'OWNER' &&
    (path === '/workouts' || path === '/measurements') ? (
    <OfflineWrites
      kind={path === '/workouts' ? 'workout' : 'measurement'}
      key={path}
    />
  ) : null;
}
