import type { OfflineSnapshot } from '@/contracts/offline';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function selectedDate(url: URL, fallback: string) {
  const value = url.searchParams.get('date');
  return value && datePattern.test(value) ? value : fallback;
}

/** Whether the current fenced snapshot can render the destination without RSC. */
export function hasSavedReadRoute(snapshot: OfflineSnapshot, url: URL) {
  if (url.pathname === '/') return snapshot.views.summary !== null;
  if (url.pathname === '/diary')
    return snapshot.diary.some(
      (day) => day.date === selectedDate(url, snapshot.to),
    );
  if (url.pathname === '/measurements') return true;
  if (url.pathname === '/analytics') {
    const summary = snapshot.views.summary;
    if (!summary) return false;
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (from === null && to === null) return true;
    return (
      from !== null &&
      to !== null &&
      datePattern.test(from) &&
      datePattern.test(to) &&
      from <= to &&
      from >= summary.from &&
      to <= summary.to
    );
  }
  if (url.pathname === '/workouts')
    return snapshot.workoutDates.includes(selectedDate(url, snapshot.to));
  if (
    url.pathname.startsWith('/workouts/') &&
    !/\/(?:edit|results)$/.test(url.pathname) &&
    !/\/workouts\/(?:new|sessions\/new)$/.test(url.pathname)
  )
    return [
      ...snapshot.plannedWorkouts,
      ...snapshot.workoutSessions,
      ...snapshot.nativeTrainings,
      ...snapshot.transformMateFacts,
    ].some((item) => item.href === url.pathname);
  return false;
}
