import 'server-only';
import { z } from 'zod';
import {
  healthAutoExportMetrics,
  type HealthAutoExportMetric,
  type HealthAutoExportSample,
  type HealthAutoExportSleepStage,
} from '@/contracts/health-auto-export';

const sampleLimit = 25000;
const wireQuantity = z
  .number()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const wireMetric = z.object({
  name: z.string().min(1).max(128),
  units: z.string().min(1).max(32).optional(),
  data: z.array(z.unknown()).max(sampleLimit),
});
const wirePayload = z.object({
  data: z.object({ metrics: z.array(wireMetric).max(256) }),
});
const wireSample = z.object({
  date: z.string().min(1).max(40),
  start: z.string().min(1).max(40).optional(),
  end: z.string().min(1).max(40).optional(),
  startDate: z.string().min(1).max(40).optional(),
  endDate: z.string().min(1).max(40).optional(),
  source: z
    .string()
    .max(512)
    .refine((value) => !/\p{Cc}/u.test(value))
    .nullish(),
  qty: wireQuantity.optional(),
  value: z.string().min(1).max(32).optional(),
  Avg: wireQuantity.optional(),
  Min: wireQuantity.optional(),
  Max: wireQuantity.optional(),
});
const localDate = z.iso.date();
const datePattern =
  /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,3})?\s?(Z|([+-])(\d{2}):?(\d{2}))$/;
const knownMetric = z.enum(healthAutoExportMetrics);

const phase = new Map<string, HealthAutoExportSleepStage>([
  ['asleep', 'asleep'],
  ['во сне', 'asleep'],
  ['core', 'core'],
  ['основная', 'core'],
  ['deep', 'deep'],
  ['глубокий', 'deep'],
  ['rem', 'rem'],
  ['бдг', 'rem'],
  ['awake', 'awake'],
  ['бодрствование', 'awake'],
  ['in bed', 'in_bed'],
  ['в кровати', 'in_bed'],
  ['unspecified', 'unspecified'],
  ['не задано', 'unspecified'],
]);

export class HealthAutoExportPayloadError extends Error {}

function invalidPayload(): never {
  throw new HealthAutoExportPayloadError('Invalid health metrics export');
}

function timestamp(value: string) {
  const match = datePattern.exec(value);
  if (!match) return invalidPayload();
  const [, date, hours, minutes, seconds, fraction, , sign, offsetH, offsetM] =
    match;
  const offsetHours = Number(offsetH ?? 0);
  const offsetMinutes = Number(offsetM ?? 0);
  if (
    !date ||
    !localDate.safeParse(date).success ||
    offsetMinutes >= 60 ||
    offsetHours * 60 + offsetMinutes > 14 * 60
  )
    return invalidPayload();
  const offset = (offsetHours * 60 + offsetMinutes) * (sign === '-' ? -1 : 1);
  const local = Date.parse(
    `${date}T${hours}:${minutes}:${seconds}${fraction ?? ''}Z`,
  );
  const milliseconds = local - offset * 60000;
  const at = new Date(milliseconds).toISOString();
  if (at.length !== 24) return invalidPayload();
  return { at, offset, date, milliseconds };
}

type QuantityMetric = Exclude<HealthAutoExportMetric, 'sleep_analysis'>;
type Measurement = Pick<
  HealthAutoExportSample,
  'value' | 'unit' | 'min' | 'max'
>;
const quantities = {
  heart_rate_variability: { wireUnit: 'ms', unit: 'ms' },
  resting_heart_rate: { wireUnit: 'count/min', unit: 'bpm' },
  heart_rate: { wireUnit: 'count/min', unit: 'bpm' },
  respiratory_rate: { wireUnit: 'count/min', unit: 'breaths/min' },
  apple_sleeping_wrist_temperature: { wireUnit: 'degC', unit: '°C' },
  blood_oxygen_saturation: { wireUnit: '%', unit: '%' },
  breathing_disturbances: { wireUnit: 'count', unit: 'count' },
} as const satisfies Record<
  QuantityMetric,
  { wireUnit: string; unit: HealthAutoExportSample['unit'] }
>;

function quantity(
  metric: QuantityMetric,
  units: string | undefined,
  sample: z.infer<typeof wireSample>,
): Measurement {
  const { wireUnit, unit } = quantities[metric];
  const fahrenheit =
    metric === 'apple_sleeping_wrist_temperature' && units === 'degF';
  if (units !== wireUnit && !fahrenheit) return invalidPayload();
  const value = metric === 'heart_rate' ? sample.Avg : sample.qty;
  const min = metric === 'heart_rate' ? (sample.Min ?? null) : null;
  const max = metric === 'heart_rate' ? (sample.Max ?? null) : null;
  if (
    value === undefined ||
    (metric !== 'apple_sleeping_wrist_temperature' && value < 0) ||
    (metric === 'blood_oxygen_saturation' && value > 100) ||
    (min !== null && min < 0) ||
    (max !== null && max < 0)
  )
    return invalidPayload();
  return {
    unit,
    value: fahrenheit ? ((value - 32) / 9) * 5 : value,
    min,
    max,
  };
}

function normalizeSample(
  metric: HealthAutoExportMetric,
  units: string | undefined,
  raw: unknown,
): HealthAutoExportSample {
  const parsed = wireSample.safeParse(raw);
  if (!parsed.success) return invalidPayload();
  const sample = parsed.data;
  const date = timestamp(sample.date);
  const suppliedStart = sample.start ?? sample.startDate;
  const suppliedEnd = sample.end ?? sample.endDate;
  const start = suppliedStart ? timestamp(suppliedStart) : date;
  const end = suppliedEnd ? timestamp(suppliedEnd) : start;
  const duration = (end.milliseconds - start.milliseconds) / 1000;
  if (
    (sample.start &&
      sample.startDate &&
      timestamp(sample.startDate).at !== start.at) ||
    (sample.end && sample.endDate && timestamp(sample.endDate).at !== end.at) ||
    duration < 0
  )
    return invalidPayload();

  const interval = {
    metric,
    source: sample.source?.trim() || null,
    startAt: start.at,
    endAt: end.at,
    startOffsetMinutes: start.offset,
    endOffsetMinutes: end.offset,
    startDate: start.date,
    endDate: end.date,
  };
  if (metric !== 'sleep_analysis')
    return { ...interval, stage: null, ...quantity(metric, units, sample) };

  const stage = sample.value && phase.get(sample.value.trim().toLowerCase());
  if (
    !stage ||
    !suppliedStart ||
    !suppliedEnd ||
    duration <= 0 ||
    units !== 'hr'
  )
    return invalidPayload();
  return {
    ...interval,
    stage,
    value: duration,
    unit: 'seconds',
    min: null,
    max: null,
  };
}

export function normalizeHealthAutoExport(payload: unknown) {
  const result = wirePayload.safeParse(payload);
  if (!result.success) return invalidPayload();
  const metrics = result.data.data.metrics;
  const received = metrics.reduce((sum, metric) => sum + metric.data.length, 0);
  if (received > sampleLimit) return invalidPayload();

  let ignored = 0;
  const samples: HealthAutoExportSample[] = [];
  for (const metric of metrics) {
    const name = knownMetric.safeParse(metric.name);
    if (!name.success) {
      ignored += metric.data.length;
      continue;
    }
    for (const raw of metric.data)
      samples.push(normalizeSample(name.data, metric.units, raw));
  }
  return { samples, received, ignored };
}
