import { it, expect } from 'vitest';
import { nutritionChart } from '@/features/analytics/nutrition-chart';
import type { NutritionAnalysis } from '@/contracts/analytics';
it('hatches incomplete days even with known calories and keeps empty/missing days as gaps', () => {
  const rows: NutritionAnalysis['days'] = [
    {
      date: '2026-10-01',
      quality: 'complete',
      recorded: true,
      totals: { calories: '0', protein: '0', fat: '0', carbs: '0' },
      knownTotals: { calories: '0', protein: '0', fat: '0', carbs: '0' },
    },
    {
      date: '2026-10-02',
      quality: 'partial',
      recorded: true,
      totals: { calories: '2000', protein: null, fat: '1', carbs: '2' },
      knownTotals: { calories: '2000', protein: '10', fat: '1', carbs: '2' },
    },
    {
      date: '2026-10-03',
      quality: 'partial',
      recorded: true,
      totals: { calories: null, protein: null, fat: '1', carbs: '2' },
      knownTotals: { calories: '1840', protein: '10', fat: '1', carbs: '2' },
    },
    {
      date: '2026-10-04',
      quality: 'empty',
      recorded: true,
      totals: { calories: '0', protein: '0', fat: '0', carbs: '0' },
      knownTotals: { calories: '0', protein: '0', fat: '0', carbs: '0' },
    },
    {
      date: '2026-10-05',
      quality: 'missing',
      recorded: false,
      totals: { calories: null, protein: null, fat: null, carbs: null },
      knownTotals: { calories: null, protein: null, fat: null, carbs: null },
    },
  ];
  expect(nutritionChart(rows)).toEqual([
    { date: '2026-10-01', complete: 0, partial: null },
    { date: '2026-10-02', complete: null, partial: 2000 },
    { date: '2026-10-03', complete: null, partial: 1840 },
    { date: '2026-10-04', complete: null, partial: null },
    { date: '2026-10-05', complete: null, partial: null },
  ]);
});
