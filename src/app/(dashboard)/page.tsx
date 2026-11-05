import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireSession } from '@/server/auth/guards';
import { findActiveWorkoutForOwner } from '@/server/workouts';

export default async function Page() {
  const { user } = await requireSession();
  if (user.role === 'OWNER') {
    const workout = await findActiveWorkoutForOwner(await headers(), user.id);
    if (workout) {
      const query = new URLSearchParams({
        date: workout.date,
        workout: workout.id,
      });
      redirect(`/workouts?${query}`);
    }
  }
  redirect('/overview');
}
