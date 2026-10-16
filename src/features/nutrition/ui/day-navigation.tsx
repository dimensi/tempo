'use client';
import { ReadLink as Link } from '@/components/shared/read-link';
import { useReadRouter as useRouter } from '@/lib/workspace-navigation';
import { requestReadNavigation } from '@/components/shared/read-link';
import { Button } from '@mantine/core';
import {
  DateNavigation,
  DateDayLabel,
  type DateDayButton,
} from '@/components/shared/date-navigation';
import { diaryMessages as m } from './messages';
function PendingDayLabel({ value }: { value: string }) {
  const pending = false;
  return (
    <DateDayLabel value={value} pending={pending} loadingLabel={m.loadingDay} />
  );
}
function renderDay({ value, selected, label }: DateDayButton) {
  return (
    <Button
      key={value}
      component={Link}
      href={`/diary?date=${value}`}
      data-read-scroll="false"
      variant={selected ? 'filled' : 'subtle'}
      aria-current={selected ? 'date' : undefined}
      aria-label={label}
      h={68}
      px={0}
      radius="md"
    >
      <PendingDayLabel value={value} />
    </Button>
  );
}
export function DayNavigation({ date }: { date: string }) {
  const router = useRouter();
  return (
    <DateNavigation
      date={date}
      labels={m}
      onSelect={(value) => {
        const href = `/diary?date=${value}`;
        requestReadNavigation(href, { scroll: false }, () =>
          router.push(href, { scroll: false }),
        );
      }}
      renderDay={renderDay}
    />
  );
}
