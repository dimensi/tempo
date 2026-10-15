'use client';
import { usePathname } from 'next/navigation';
import { OfflineWrites } from '@/features/offline';
export function DeviceWrites({ role }: { role: string }) {
  const path = usePathname();
  return role === 'OWNER' &&
    (path === '/workouts' || path === '/measurements') ? (
    <OfflineWrites
      kind={path === '/workouts' ? 'workout' : 'measurement'}
      key={path}
    />
  ) : null;
}
