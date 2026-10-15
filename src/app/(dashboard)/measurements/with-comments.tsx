'use client';
import { MeasurementsPanel } from '@/features/measurements';
import { CommentsPanel } from '@/features/comments';
import type { WeightHistory } from '@/contracts/health';
export function MeasurementsWithComments(props: {
  ownerId: string;
  writable: boolean;
  deviceWrites?: boolean;
  weightHistory: WeightHistory;
}) {
  return (
    <MeasurementsPanel
      {...props}
      renderComments={(id) => (
        <CommentsPanel
          ownerId={props.ownerId}
          target={{ type: 'measurement', id }}
        />
      )}
    />
  );
}
