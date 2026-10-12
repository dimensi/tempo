'use client';
import type { ComponentProps } from 'react';
import { WorkoutDetailView } from '@/features/workouts';
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

export function WorkoutDetailWithComments(
  props: Omit<ComponentProps<typeof WorkoutDetailView>, 'renderComments'>,
) {
  return (
    <WorkoutDetailView
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
