import Decimal from 'decimal.js';
import type { StepsSummary } from '@/contracts/health';
const Exact = Decimal.clone({ precision: 40 });

export function summarizeSteps(days: StepsSummary['days']) {
  const observed = days.filter((day) => day.steps !== null);
  const total = observed.reduce(
    (sum, day) => sum.plus(day.steps!),
    new Exact(0),
  );
  return {
    observedDays: observed.length,
    average: observed.length ? total.div(observed.length).toFixed() : null,
  };
}
export function stepsProgress(steps: string | null, goal: number | null) {
  if (steps === null || goal === null) return null;
  const percent = new Exact(steps).div(goal).mul(100);
  return {
    percent: percent.toFixed(0, Decimal.ROUND_HALF_UP),
    width: Exact.min(100, percent).toNumber(),
  };
}
