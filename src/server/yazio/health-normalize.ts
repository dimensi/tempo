import 'server-only';
import { z } from 'zod';
import {
  yazioWeightWireSchema,
  yazioHealthSummaryWireSchema,
  type ImportedWeight,
  type DailySteps,
} from '@/contracts/yazio-health';

export function normalizeHealthSummary(payload: unknown, date: string) {
  const parsed = yazioHealthSummaryWireSchema.parse(payload);
  const dailySteps: DailySteps = {
    source: 'yazio',
    date: z.iso.date().parse(date),
    steps: parsed.steps ?? null,
  };
  return { dailySteps, unitContext: parsed.units?.unit_mass ?? null };
}

export function normalizeYazioWeight(
  payload: unknown,
  unitContext: string | null,
): ImportedWeight | null {
  const record = yazioWeightWireSchema.parse(payload);
  if (!record) return null;
  return {
    source: 'yazio',
    externalId: record.id.toLowerCase(),
    providerDate: record.date,
    measuredDate: z.iso.date().safeParse(record.date).success
      ? record.date
      : null,
    rawValue: record.value === null ? null : String(record.value),
    unit: null,
    unitContext: z.string().max(128).nullable().parse(unitContext),
    upstreamSource: record.source,
    gateway: record.gateway,
  };
}

// The last-entry endpoint can return one record on several requested days.
export function deduplicateYazioWeights(records: ImportedWeight[]) {
  return [
    ...new Map(records.map((record) => [record.externalId, record])).values(),
  ];
}
