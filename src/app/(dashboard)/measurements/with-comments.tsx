'use client';
import { MeasurementsPanel } from '@/features/measurements';
import { CommentsPanel } from '@/features/comments';
export function MeasurementsWithComments(props: {
  ownerId: string;
  writable: boolean;
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
