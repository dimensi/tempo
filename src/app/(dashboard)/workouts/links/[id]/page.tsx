'use client';
import { useParams } from 'next/navigation';
import { useWorkoutDetail } from '@/app/(dashboard)/workouts/use-workout-detail';
import { ResourcePending } from '@/components/shared/read-resource-pending';
import { CommentsPanel } from '@/features/comments';
import { WorkoutDetailView } from '@/features/workouts';
export default function Page() {
  const params = useParams<{ id: string }>();
  const { context, date, read } = useWorkoutDetail({
    kind: 'link',
    id: params.id,
  });
  if (!read.data) return <ResourcePending {...read} />;
  return (
    <WorkoutDetailView
      ownerId={context.ownerId}
      canLog={context.role === 'OWNER'}
      date={date}
      detail={read.data}
      renderComments={(id) => (
        <CommentsPanel
          ownerId={context.ownerId}
          target={{ type: 'workout', id }}
        />
      )}
    />
  );
}
