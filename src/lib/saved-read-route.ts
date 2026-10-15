import type { OfflineSnapshot } from '@/contracts/offline';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function weekRange(today: string) {
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 6);
  return { from: from.toISOString().slice(0, 10), to: today };
}

function selectedDate(url: URL, fallback: string) {
  const value = url.searchParams.get('date');
  return value && datePattern.test(value) ? value : fallback;
}

/** Whether the current fenced snapshot can render the destination without RSC. */
export function hasSavedReadRoute(
  snapshot: OfflineSnapshot,
  url: URL,
  today = localToday(),
) {
  if (url.pathname === '/') return snapshot.views.summary !== null;
  if (url.pathname === '/diary')
    return snapshot.diary.some((day) => day.date === selectedDate(url, today));
  if (url.pathname === '/measurements') return true;
  if (url.pathname === '/workouts/catalog') return true;
  if (url.pathname === '/settings') return snapshot.views.settings !== null;
  if (url.pathname === '/reports') return true;
  if (url.pathname === '/analytics') {
    const summary = snapshot.views.summary;
    if (!summary) return false;
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const range =
      from === null && to === null ? weekRange(today) : { from, to };
    return (
      range.from !== null &&
      range.to !== null &&
      datePattern.test(range.from) &&
      datePattern.test(range.to) &&
      range.from <= range.to &&
      range.from >= summary.from &&
      range.to <= summary.to
    );
  }
  if (url.pathname === '/workouts')
    return snapshot.workoutDates.includes(selectedDate(url, today));
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
