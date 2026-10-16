'use client';
import {
  DateDayLabel,
  DateNavigation,
  type DateDayButton,
} from '@/components/shared/date-navigation';
import { Button } from '@mantine/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { diaryMessages as m } from './messages';
function PendingDayLabel({
  value,
  pending,
}: {
  value: string;
  pending: boolean;
}) {
  return (
    <DateDayLabel value={value} pending={pending} loadingLabel={m.loadingDay} />
  );
}
function renderDay(
  { value, selected, label }: DateDayButton,
  pending: boolean,
) {
  return (
    <Button
      key={value}
      component={Link}
      href={`/diary?date=${value}`}
      scroll={false}
      prefetch={false}
      variant={selected ? 'filled' : 'subtle'}
      aria-current={selected ? 'date' : undefined}
      aria-label={label}
      h={68}
      px={0}
      radius="md"
    >
      <PendingDayLabel value={value} pending={selected && pending} />
    </Button>
  );
}
export function DayNavigation({
  date,
  pending = false,
}: {
  date: string;
  pending?: boolean;
}) {
  const router = useRouter();
  return (
    <DateNavigation
      date={date}
      labels={m}
      onSelect={(value) => {
        const href = `/diary?date=${value}`;
        router.push(href, { scroll: false });
      }}
      renderDay={(day) => renderDay(day, pending)}
    />
  );
}
