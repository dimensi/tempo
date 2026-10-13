'use client';
import { SegmentedControl, Tooltip } from '@mantine/core';
import { workoutMessages as m } from './messages';
export function WorkoutCreateChoice({
  kind,
  date,
  returnDate,
  canLog,
  busy = false,
  onNavigate,
}: {
  kind: 'planned' | 'performed';
  date: string;
  returnDate: string;
  canLog: boolean;
  busy?: boolean;
  onNavigate: (path: string) => void;
}) {
  return (
    <Tooltip label={canLog ? m.createKind : m.actualOwnerOnly} withArrow>
      <SegmentedControl
        aria-label={m.createKind}
        value={kind}
        disabled={busy}
        styles={{
          label: {
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
        }}
        size="md"
        data={[
          { value: 'planned', label: m.createPlanned },
          { value: 'performed', label: m.createPerformed, disabled: !canLog },
        ]}
        onChange={(value) =>
          onNavigate(
            `/workouts/${value === 'performed' ? 'sessions/new' : 'new'}?date=${date}&returnDate=${returnDate}`,
          )
        }
      />
    </Tooltip>
  );
}
