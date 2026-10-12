// Diary dates are calendar dates; UTC here avoids timezone/DST conversion.
export function weeklyRange(
  start: string,
): { end: string; label: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const first = new Date(`${start}T00:00:00Z`);
  if (
    !Number.isFinite(first.getTime()) ||
    first.toISOString().slice(0, 10) !== start
  )
    return null;
  const last = new Date(first);
  last.setUTCDate(last.getUTCDate() + 6);
  const format = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return {
    end: last.toISOString().slice(0, 10),
    label: `${format.format(first)} — ${format.format(last)}`,
  };
}
