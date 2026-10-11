'use client';
import { WorkoutsDashboard } from '@/features/workouts';
import { CommentsPanel } from '@/features/comments';
export function WorkoutsWithComments(props: {
  ownerId: string;
  canLog: boolean;
}) {
  return (
    <WorkoutsDashboard
      {...props}
      renderComments={(id) => (
        <CommentsPanel
          ownerId={props.ownerId}
          target={{ type: 'workout', id }}
        />
      )}
    />
  );
}
