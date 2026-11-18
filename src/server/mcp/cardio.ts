import 'server-only';
import type { CardioWorkout } from '@/contracts/cardio-workouts';
import { cardioDate, cardioMetrics } from '@/lib/cardio-workouts';
import { getDatabase } from '@/server/db';
import { cardioRepository } from '@/server/workouts/cardio-repository';

export const cardioUnits = {
  duration: 'seconds',
  distance: 'm',
  energy: 'kcal',
};

function mcpCardioRow(
  row: CardioWorkout,
  manual: CardioWorkout | undefined,
  fetchedAt: string | null,
  failedAt: string | null,
) {
  const metrics = cardioMetrics(row, manual);
  const date = cardioDate(row);
  return {
    kind: 'cardio',
    id: row.id,
    date,
    workoutRef: { kind: 'cardio', id: row.id, date },
    title: metrics.type,
    revision: row.revision,
    source: row.imported ? 'YAZIO' : 'LOCAL',
    executionStatus: 'completed' as const,
    activity: row.imported?.strength ? 'strength' : 'cardio',
    metrics,
    link: row.link,
    manual: row.manual ?? manual?.manual ?? null,
    manualRecord: manual ? { id: manual.id, revision: manual.revision } : null,
    importedRecord: row.imported
      ? {
          providerId: row.imported.providerId,
          providerDate: row.imported.providerDate,
          type: row.imported.type,
          source: row.imported.providerSource,
          gateway: row.imported.gateway,
          bucket: row.imported.bucket,
          id: row.id,
          revision: row.revision,
        }
      : null,
    overrides: row.overrides,
    freshness: row.imported ? { fetchedAt, failedAt } : null,
  };
}

export function findMcpCardioRow(ownerId: string, id: string) {
  const row = cardioRepository(getDatabase().db).find(ownerId, id);
  if (!row) return;
  const date = cardioDate(row);
  return mcpCardioRange(ownerId, date, date).view(row);
}

export function mcpCardioRange(ownerId: string, from: string, to: string) {
  const repo = cardioRepository(getDatabase().db);
  const coverage = repo.coverage(ownerId, from, to);
  const byDate = new Map(coverage.map((entry) => [entry.date, entry]));
  const rows = repo.list(ownerId, from, to);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    rows,
    coverage,
    view(row: CardioWorkout) {
      const entry = byDate.get(cardioDate(row));
      return mcpCardioRow(
        row,
        row.link?.kind === 'cardio' ? byId.get(row.link.id) : undefined,
        entry?.fetchedAt ?? null,
        entry?.failedAt ?? null,
      );
    },
  };
}
