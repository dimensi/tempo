import { workoutTitleMessages as m } from '@/config/messages';
/** Calendar days are formatted in UTC so browser/server timezones cannot shift them. */
export function workoutTitle(title: string, date: string): string {
  if (title.trim()) return title;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))
    return m.unnamed;
  const day = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
  return `${m.unnamed} · ${day}`;
}
