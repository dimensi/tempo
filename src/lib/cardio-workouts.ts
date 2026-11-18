import type { CardioWorkout } from '@/contracts/cardio-workouts';

export const cardioDate = (row: CardioWorkout) =>
  row.imported?.date ?? row.manual!.date;

export function cardioMetrics(
  row: CardioWorkout,
  linkedManual?: CardioWorkout,
) {
  const manual = row.manual ?? linkedManual?.manual;
  const source = row.imported;
  const overrides = row.overrides;
  const distance =
    overrides.distanceMeters !== undefined
      ? overrides.distanceMeters
      : (manual?.distanceMeters ?? (source?.distanceMeters || null));
  return {
    type: manual?.type ?? source!.type,
    time: source?.time ?? manual?.time ?? null,
    durationSeconds: source?.durationSeconds || manual?.durationSeconds || null,
    distanceMeters: distance ?? null,
    energyKcal: source?.energyKcal ?? manual?.energyKcal ?? null,
    equipment:
      overrides.equipment !== undefined
        ? overrides.equipment
        : (manual?.equipment ?? null),
    note: overrides.note ?? (manual?.note || source?.note || ''),
  };
}
export function standaloneCardio(rows: CardioWorkout[]) {
  const linkedManualIds = new Set(
    rows
      .filter((row) => row.link?.kind === 'cardio')
      .map((row) => row.link!.id),
  );
  return rows.filter(
    (row) => row.link?.kind !== 'strength' && !linkedManualIds.has(row.id),
  );
}
