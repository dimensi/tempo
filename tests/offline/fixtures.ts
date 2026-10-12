import { shiftDate } from '@/contracts/nutrition-sync-dates';
import {
  ownerConfirmedYazioWeightPolicyVersion,
  ownerConfirmedYazioWeightUnit,
} from '@/contracts/yazio-weight-policy';
import {
  offlineSnapshotSchema,
  type OfflineSnapshot,
} from '@/contracts/offline';
export function offlineFixture(now: number): OfflineSnapshot {
  const date = new Date(now).toISOString().slice(0, 10);
  const totals = { calories: '0', protein: null, fat: '0', carbs: '1.125' };
  const day = {
    date,
    fetchedAt: new Date(now).toISOString(),
    totals,
    knownTotals: { ...totals, protein: '1.5' },
    officialTotals: totals,
    delta: { calories: '0', protein: null, fat: '0', carbs: '0' },
    meals: (['breakfast', 'lunch', 'dinner', 'snack'] as const).map((kind) => ({
      kind,
      totals,
      knownTotals: totals,
      officialTotals: totals,
      delta: { calories: '0', protein: null, fat: '0', carbs: '0' },
      entries:
        kind === 'breakfast'
          ? [
              {
                key: 'C'.repeat(43),
                kind: 'product',
                name: 'Synthetic breakfast',
                meal: kind,
                diaryDateTime: `${date} 08:30:00`,
                amount: '1',
                baseUnit: 'порция',
                serving: null,
                servingQuantity: null,
                consumedPortions: null,
                recipePortions: null,
                massG: null,
                volumeMl: null,
                ingredientMassEstimateG: null,
                totals,
                issues: [],
              },
            ]
          : [],
    })),
  };
  return offlineSnapshotSchema.parse({
    contractVersion: 1,
    weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
    partition: 'A'.repeat(43),
    connectionGeneration: 'B'.repeat(43),
    role: 'OWNER',
    serverNow: new Date(now).toISOString(),
    expiresAt: new Date(now + 600000).toISOString(),
    sessionExpiresAt: new Date(now + 1200000).toISOString(),
    from: shiftDate(date, -14),
    to: date,
    diary: [day],
    photos: { availability: 'metadata-only', items: [] },
    measurements: [
      {
        key: 'D'.repeat(43),
        source: 'manual',
        measuredAt: date,
        values: [
          { metric: 'weight', value: '72.125', unit: 'kg' },
          { metric: 'waist', value: '80', unit: 'cm' },
        ],
        note: 'Synthetic manual',
      },
    ],
    importedWeights: [
      {
        key: 'E'.repeat(43),
        source: 'yazio',
        providerDate: date,
        measuredDate: date,
        rawValue: null,
        ...ownerConfirmedYazioWeightUnit,
        unitContext: 'lb',
        observedAt: new Date(now).toISOString(),
      },
    ],
    dailySteps: [
      {
        date,
        source: 'yazio',
        steps: 0,
        observedAt: new Date(now).toISOString(),
      },
    ],
    plannedWorkouts: [
      {
        key: 'F'.repeat(43),
        date,
        title: 'Synthetic plan',
        planTitle: 'Synthetic programme',
        planDescription: '',
        exercises: [
          { name: 'Synthetic exercise', sets: [{ reps: 8, weightKg: 0 }] },
        ],
      },
    ],
    workoutSessions: [
      {
        key: 'G'.repeat(43),
        date,
        title: 'Synthetic actual',
        note: '',
        status: 'completed',
        exercises: [
          { name: 'Synthetic exercise', sets: [{ reps: 8, weightKg: 0 }] },
        ],
        planTitle: 'Synthetic programme',
      },
    ],
    transformMateFacts: [
      {
        key: 'H'.repeat(43),
        date,
        title: 'Synthetic cached fact',
        checkedAt: new Date(now).toISOString(),
        started: null,
        finished: null,
        exercises: [
          {
            name: 'Synthetic movement',
            comment: '',
            sets: [
              {
                order: 1,
                done: false,
                metrics: [
                  { name: 'Вес', unit: 'кг', type: 'weight', values: ['0'] },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}
