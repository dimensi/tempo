import type {
  DataEnvelope,
  NutritionDay,
  Measurement,
  Workout,
} from '@/contracts/v1';
const totals = {
  energyKcal: 420,
  proteinGrams: 20,
  fatGrams: 12,
  carbohydrateGrams: 58,
};
export const nutritionWeek: DataEnvelope<NutritionDay[]> = {
  contractVersion: 1,
  source: 'demo',
  data: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-01-0${index + 1}`,
    meals: [
      {
        id: `meal-${index}`,
        name: 'Завтрак',
        entries: [
          { id: `entry-${index}`, name: 'Демонстрационный завтрак', totals },
        ],
      },
    ],
    totals,
  })),
};
export const nutritionDay: DataEnvelope<NutritionDay> = {
  contractVersion: 1,
  source: 'demo',
  data: nutritionWeek.data[0]!,
};
export const measurements: DataEnvelope<Measurement[]> = {
  contractVersion: 1,
  source: 'demo',
  data: [75, 74.8, 74.5].map((value, index) => ({
    id: `measurement-${index}`,
    date: `2026-01-0${index + 1}`,
    kind: 'weight',
    value,
    unit: 'kg',
  })),
};
export const workouts: DataEnvelope<Workout[]> = {
  contractVersion: 1,
  source: 'demo',
  data: ['Прогулка', 'Силовая тренировка'].map((name, index) => ({
    id: `workout-${index}`,
    date: `2026-01-0${index + 1}`,
    name,
    exercises: [
      { id: `exercise-${index}`, name: 'Демонстрационное упражнение' },
    ],
  })),
};
