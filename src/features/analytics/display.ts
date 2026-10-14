import { formatDecimal } from '@/lib/number-display';
import { analyticsMessages as m } from './messages';
export const display = (value: string | number | null) =>
  formatDecimal(value) ?? m.noData;
export const signed = (value: string | null) =>
  value === null
    ? m.noData
    : `${Number(value) > 0 ? '+' : ''}${formatDecimal(value, { kind: 'delta' }) ?? m.noData}`;
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
export const rangeLabel = (range: { from: string; to: string }) =>
  `${dateLabel(range.from)} — ${dateLabel(range.to)}`;
