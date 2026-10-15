import Decimal from 'decimal.js';
import {
  healthRangeDates,
  stepsSummarySchema,
  type HealthRange,
} from '@/contracts/health';
const HealthDecimal = Decimal.clone({ precision: 40 });
export function summarizeSteps(
  range: HealthRange,
  records: { date: string; steps: number | null }[],
) {
  const byDate = new Map(records.map((record) => [record.date, record]));
  const days = healthRangeDates(range).map((date) => ({
    date,
    steps: byDate.get(date)?.steps ?? null,
    source: byDate.has(date) ? ('YAZIO' as const) : null,
  }));
  const observed = days.filter((day) => day.steps !== null);
  const total = observed.reduce(
    (sum, day) => sum.plus(day.steps!),
    new HealthDecimal(0),
  );
  return stepsSummarySchema.parse({
    range,
    days,
    observedDays: observed.length,
    totalSteps: observed.length ? total.toFixed() : null,
    averageSteps: observed.length ? total.div(observed.length).toFixed() : null,
  });
}
