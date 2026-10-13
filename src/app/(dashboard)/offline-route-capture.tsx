'use client';
import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { browserToday } from '@/components/shared/date-navigation-dates';
import { getOfflineController } from '@/features/offline';
export function OfflineRouteCapture({ role }: { role: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const date = params.get('date') ?? browserToday();
  useEffect(() => {
    if (role !== 'OWNER' || !pathname.startsWith('/workouts')) return;
    // Capture already-persisted facts after the ordinary route has loaded; no provider request.
    const capture = () => void getOfflineController().saveWorkoutDate(date);
    const timer = setTimeout(capture, 0);
    window.addEventListener('yazio:workouts-loaded', capture);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('yazio:workouts-loaded', capture);
    };
  }, [role, pathname, date]);
  return null;
}
