import 'server-only';
import { z } from 'zod';
import { importedExerciseSchema } from '@/contracts/cardio-workouts';

const row = z.object({
  id: z.string().min(1),
  date: z.string(),
  name: z.string().min(1),
  note: z.string().nullable(),
  external_id: z.string().nullable(),
  gateway: z.string().nullable(),
  source: z.string().nullable(),
  energy: z.number().nonnegative(),
  distance: z.number().nonnegative(),
  duration: z.number().nonnegative(),
});
const response = z.object({
  training: z.array(row),
  custom_training: z.array(row),
});
const strength = new Set([
  'strength',
  'strengthtraining',
  'strength_training',
  'functional_strength_training',
  'traditional_strength_training',
  'weight_training',
  'weightlifting',
]);

// Resolve a wall-clock timestamp only when it has one valid instant.
function localStart(value: string, timezone: string) {
  const wall = Date.parse(value.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(wall)) return null;
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const candidates = new Set<number>();
  for (const sample of [wall - 86400000, wall, wall + 86400000]) {
    const offset =
      Date.parse(format.format(sample).replace(' ', 'T') + 'Z') - sample;
    const candidate = wall - offset;
    if (format.format(candidate) === value) candidates.add(candidate);
  }
  return candidates.size === 1
    ? new Date([...candidates][0]!).toISOString()
    : null;
}

export function normalizeYazioExercises(
  raw: unknown,
  date: string,
  timezone: string,
) {
  const buckets = response.parse(raw);
  const byId = new Map<string, z.infer<typeof importedExerciseSchema>>();
  for (const bucket of ['training', 'custom_training'] as const) {
    for (const item of buckets[bucket]) {
      const providerDate = item.date;
      const localDate = z.iso.date().parse(providerDate.slice(0, 10));
      if (localDate !== date) throw new Error('Unexpected exercise date');
      const time = /^[ T]\d{2}:\d{2}/.test(providerDate.slice(10))
        ? z.iso.time({ precision: -1 }).parse(providerDate.slice(11, 16))
        : null;
      const timestamp = providerDate.replace(' ', 'T');
      const explicitStart = z.iso
        .datetime({ offset: true })
        .safeParse(timestamp);
      const startedAt =
        item.gateway !== 'apple_health'
          ? null
          : explicitStart.success
            ? timestamp
            : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(providerDate)
              ? localStart(providerDate, timezone)
              : null;
      const type = item.name.trim().toLowerCase().replace(/[ -]+/g, '_');
      const parsed = importedExerciseSchema.parse({
        bucket,
        providerId: item.id,
        providerDate,
        gateway: item.gateway,
        providerSource: item.source,
        externalId: item.external_id,
        date: localDate,
        time,
        startedAt,
        type: item.name,
        durationSeconds: item.duration * 60,
        distanceMeters: item.distance,
        energyKcal: item.energy,
        note: item.note ?? '',
        strength: strength.has(type),
      });
      const previous = byId.get(item.id);
      if (
        previous &&
        JSON.stringify(previous) !==
          JSON.stringify({ ...parsed, bucket: previous.bucket })
      )
        throw new Error('Conflicting exercise identity');
      if (!previous) byId.set(item.id, parsed);
    }
  }
  return [...byId.values()];
}
