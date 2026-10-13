import { describe, expect, it } from 'vitest';
import {
  emptyResultDraft,
  resultDraftInput,
  resultDraftSchema,
} from '@/features/workouts/result-draft';
import type { PlannedWorkout } from '@/contracts/workouts';

const planned: PlannedWorkout = {
  id: 'workout',
  title: '',
  date: '2026-10-13',
  exercises: [
    {
      name: 'Squat',
      comment: 'Planned only',
      transformMate: {
        exerciseId: 335,
        occurrenceKey: '00000000-0000-4000-8000-000000000001',
      },
      sets: [{ reps: 10, weightKg: 40 }],
    },
  ],
};
describe('actual result drafts', () => {
  it('uses the plan as guidance without inventing actual reps, weight or comments', () => {
    const draft = emptyResultDraft(planned.date, planned);
    expect(draft.exercises[0]).toEqual({
      name: 'Squat',
      transformMate: planned.exercises[0]!.transformMate,
      sets: [{ reps: null, weightKg: null }],
    });
    expect(resultDraftInput(draft)).toEqual({ data: null, error: 'reps' });
    expect(planned.exercises[0]!.sets[0]!.weightKg).toBe(40);
  });
  it.each(['skipped', 'in_progress'] as const)(
    'stores untouched %s as no actual exercises',
    (status) => {
      const draft = { ...emptyResultDraft(planned.date, planned), status };
      expect(resultDraftInput(draft).data?.exercises).toEqual([]);
      draft.exercises[0]!.sets[0]!.weightKg = 35;
      expect(resultDraftInput(draft).error).toBe('reps');
    },
  );
  it.each([null, 0, 1.5])(
    'rejects incomplete or noninteger reps %s without discarding entered weight',
    (reps) => {
      const draft = emptyResultDraft(planned.date, planned);
      draft.exercises[0]!.sets[0] = { reps, weightKg: 35 };
      expect(resultDraftInput(draft).error).toBe('reps');
      expect(draft.exercises[0]!.sets[0]!.weightKg).toBe(35);
    },
  );
  it('preserves nullable and zero weights in completed actuals', () => {
    const draft = emptyResultDraft(planned.date, planned);
    draft.exercises[0]!.sets = [
      { reps: 8, weightKg: null },
      { reps: 6, weightKg: 0 },
    ];
    expect(resultDraftInput(draft).data?.exercises[0]!.sets).toEqual(
      draft.exercises[0]!.sets,
    );
  });
  it('gives actionable feedback for completed work without exercises', () => {
    expect(resultDraftInput(emptyResultDraft('2026-10-13')).error).toBe(
      'exercise',
    );
  });
  it('rejects unsafe verified IDs from browser storage', () => {
    const draft = emptyResultDraft(planned.date, planned);
    draft.exercises[0]!.transformMate!.exerciseId = Number.MAX_SAFE_INTEGER + 1;
    expect(resultDraftSchema.safeParse(draft).success).toBe(false);
  });
});
