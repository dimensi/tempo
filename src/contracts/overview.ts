import type { NutritionTotals } from '@/contracts/nutrition';
import type { DailyGoals } from './daily-goals';
export interface OverviewData {
  goals: DailyGoals;
  steps: number | null;
  today: string;
  timezone: string;
  nutrition: {
    today: NutritionTotals | null;
    meanCalories: string | null;
    recordedDays: number;
    confirmedDays: number;
    partialDays: number;
  };
  weight: {
    latest: { date: string; value: string } | null;
    points: Array<{ date: string; value: string | null }>;
  };
  workouts: {
    planned: { title: string; date: string } | null;
    completed: { title: string; date: string } | null;
  };
  sync?: { running: boolean; lastSuccess: string | null; hasError: boolean };
}
