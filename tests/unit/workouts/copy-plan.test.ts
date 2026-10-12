import { describe, expect, it } from 'vitest';
import { copyPlanToDate } from '@/features/workouts/copy-plan';
import type { WorkoutPlanInput } from '@/contracts/workouts';
describe('copy plan', () => {
  it('shifts calendar days across DST and preserves plans while replacing identities', () => {
    const plan: WorkoutPlanInput = {
      title: 'Сила',
      description: 'Заметка',
      startsOn: '2026-03-28',
      endsOn: '2026-03-30',
      workouts: [
        {
          id: 'original',
          date: '2026-03-29',
          title: 'Ноги',
          exercises: [
            {
              name: 'Приседание',
              comment: 'Медленно',
              transformMate: {
                exerciseId: 7,
                occurrenceKey: '00000000-0000-4000-8000-000000000001',
              },
              sets: [{ reps: 8, weightKg: 40 }],
            },
          ],
        },
      ],
    };
    const copied = copyPlanToDate(plan, '2026-10-24');
    expect(copied.startsOn).toBe('2026-10-24');
    expect(copied.endsOn).toBe('2026-10-26');
    expect(copied.workouts[0]!.date).toBe('2026-10-25');
    expect(copied.workouts[0]!.id).not.toBe('original');
    expect(
      copied.workouts[0]!.exercises[0]!.transformMate?.occurrenceKey,
    ).not.toBe(plan.workouts[0]!.exercises[0]!.transformMate?.occurrenceKey);
    expect(copied.workouts[0]!.exercises[0]!.sets).toEqual([
      { reps: 8, weightKg: 40 },
    ]);
    expect(copied.workouts[0]!.exercises[0]!.comment).toBe('Медленно');
    expect(copied.description).toBe('Заметка');
    copied.workouts[0]!.exercises[0]!.sets[0]!.reps = 3;
    expect(plan.workouts[0]!.exercises[0]!.sets[0]!.reps).toBe(8);
  });
});
