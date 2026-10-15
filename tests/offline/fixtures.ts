import { dateInTimezone, shiftDate } from '@/contracts/nutrition-sync-dates';
import {
  ownerConfirmedYazioWeightPolicyVersion,
  ownerConfirmedYazioWeightUnit,
} from '@/contracts/yazio-weight-policy';
import {
  offlineSnapshotSchema,
  type OfflineSnapshot,
} from '@/contracts/offline';
export function offlineFixture(now: number, timezone = 'UTC'): OfflineSnapshot {
  const date = dateInTimezone(new Date(now), timezone);
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
    contractVersion: 2,
    weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
    partition: 'A'.repeat(43),
    connectionGeneration: 'B'.repeat(43),
    role: 'OWNER',
    serverNow: new Date(now).toISOString(),
    expiresAt: new Date(now + 600000).toISOString(),
    sessionExpiresAt: new Date(now + 1200000).toISOString(),
    from: shiftDate(date, -14),
    to: date,
    views: {
      summary: null,
      settings: null,
      comments: [],
      commentsComplete: true,
      catalog: [],
      catalogComplete: false,
      videos: [],
    },
    workoutDates: [date],
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
        href: '/workouts/plans/synthetic-plan/workouts/synthetic-workout',
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
        href: '/workouts/sessions/synthetic-session',
        plannedHref: null,
        planSnapshot: null,
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
    nativeTrainings: [
      {
        key: 'N'.repeat(43),
        href: '/workouts/native/101',
        source: 'transformmate',
        date,
        title: 'Synthetic native history',
        progress: 'idle',
        started: null,
        finished: null,
        remoteUpdatedAt: new Date(now).toISOString(),
        fetchedAt: new Date(now).toISOString(),
        exercises: [
          {
            protocolOrder: 1,
            order: 1,
            name: 'Synthetic native movement',
            comment: 'Synthetic native note',
            metrics: [
              {
                type: 'plan',
                sets: [
                  {
                    order: 1,
                    done: null,
                    metrics: [
                      {
                        name: 'Duration',
                        unit: 'мин',
                        type: 'range',
                        values: ['01–03'],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'fact',
                sets: [
                  {
                    order: 1,
                    done: false,
                    metrics: [
                      {
                        name: 'Weight',
                        unit: 'кг',
                        type: 'number',
                        values: ['0'],
                      },
                      {
                        name: 'Missing',
                        unit: 'сек',
                        type: 'number',
                        values: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    transformMateFacts: [
      {
        key: 'H'.repeat(43),
        href: '/workouts/links/synthetic-link',
        nativeHref: null,
        plannedHref: null,
        planSnapshot: { title: 'Synthetic published plan', exercises: [] },
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
