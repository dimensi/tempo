import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { getDatabase } from '@/server/db';
import {
  cardioWorkouts,
  yazioExerciseCoverage,
} from '@/server/db/schema/cardio-workouts';
import { workouts } from '@/server/db/schema/workouts';
import type {
  CardioCommand,
  CardioWorkout,
  ImportedExercise,
} from '@/contracts/cardio-workouts';

type Row = typeof cardioWorkouts.$inferSelect;
type Database = ReturnType<typeof getDatabase>['db'];
export class CardioError extends Error {
  constructor(readonly status: 400 | 404 | 409) {
    super('Cardio operation failed');
  }
}

function dto(row: Row): CardioWorkout {
  return {
    id: row.id,
    revision: row.revision,
    manual: row.manual,
    imported: row.imported,
    overrides: row.overrides ?? {},
    link:
      row.linkKind && row.linkId
        ? { kind: row.linkKind, id: row.linkId }
        : null,
  };
}

export function cardioRepository(db: Database) {
  const scope = (ownerId: string, id: string) =>
    and(eq(cardioWorkouts.ownerId, ownerId), eq(cardioWorkouts.id, id));
  const dayScope = (ownerId: string, date: string) =>
    and(eq(cardioWorkouts.ownerId, ownerId), eq(cardioWorkouts.date, date));
  const get = (ownerId: string, id: string) =>
    db.select().from(cardioWorkouts).where(scope(ownerId, id)).get();
  const getDayRows = (ownerId: string, date: string) =>
    db.select().from(cardioWorkouts).where(dayScope(ownerId, date)).all();
  const set = (row: Row, values: Partial<Row>) =>
    db
      .update(cardioWorkouts)
      .set({ ...values, revision: sql`${cardioWorkouts.revision} + 1` })
      .where(scope(row.ownerId, row.id))
      .returning()
      .get();
  const coverageScope = (ownerId: string, from: string, to: string) =>
    and(
      eq(yazioExerciseCoverage.ownerId, ownerId),
      gte(yazioExerciseCoverage.date, from),
      lte(yazioExerciseCoverage.date, to),
    );
  const getTarget = (ownerId: string, id: string) =>
    db
      .select()
      .from(workouts)
      .where(and(eq(workouts.ownerId, ownerId), eq(workouts.id, id)))
      .get();
  function refreshMatch(ownerId: string, date: string) {
    const rows = getDayRows(ownerId, date);
    const local = db
      .select()
      .from(workouts)
      .where(and(eq(workouts.ownerId, ownerId), eq(workouts.date, date)))
      .all();
    const localIds = new Set(local.map((workout) => workout.id));
    const explicitTargets = new Set<string>();
    for (const row of rows) {
      if (row.linkKind !== 'strength' || !row.linkId || row.automaticLink)
        continue;
      if (!localIds.has(row.linkId))
        set(row, { linkKind: null, linkId: null, suppressMatch: true });
      else if (row.present) explicitTargets.add(row.linkId);
    }
    const executed = local.filter(
      (row) =>
        row.data.status === 'completed' &&
        row.data.execution?.finishedAt &&
        !explicitTargets.has(row.id),
    );
    const matches = new Map<string, string[]>();
    const counts = new Map<string, number>();
    for (const row of rows) {
      const source = row.imported;
      if (
        !row.present ||
        !source?.strength ||
        !source.startedAt ||
        !source.durationSeconds ||
        row.suppressMatch ||
        (row.linkId && !row.automaticLink)
      )
        continue;
      const from = Date.parse(source.startedAt);
      const length = source.durationSeconds * 1000;
      for (const target of executed) {
        const start = Date.parse(target.data.execution!.startedAt);
        const end = Date.parse(target.data.execution!.finishedAt!);
        const overlap = Math.min(end, from + length) - Math.max(start, from);
        if (overlap < 0.8 * length || overlap < 0.8 * (end - start)) continue;
        matches.set(row.id, [...(matches.get(row.id) ?? []), target.id]);
        counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
      }
    }
    const desired = new Map<string, string>();
    for (const [id, targets] of matches) {
      if (targets.length === 1 && counts.get(targets[0]!) === 1)
        desired.set(id, targets[0]!);
    }
    for (const row of rows) {
      if (row.automaticLink && desired.get(row.id) !== row.linkId)
        set(row, { linkKind: null, linkId: null, automaticLink: false });
    }
    for (const row of rows) {
      const target = desired.get(row.id);
      if (target && row.linkId !== target)
        set(row, { linkKind: 'strength', linkId: target, automaticLink: true });
    }
  }
  function coverage(ownerId: string, from: string, to: string) {
    return db
      .select()
      .from(yazioExerciseCoverage)
      .where(coverageScope(ownerId, from, to))
      .orderBy(yazioExerciseCoverage.date)
      .all()
      .map(({ date, fetchedAt, failedAt }) => ({ date, fetchedAt, failedAt }));
  }
  function visible(row: Row): CardioWorkout {
    const result = dto(row);
    if (result.link?.kind === 'strength') {
      const target = getTarget(row.ownerId, result.link.id);
      if (target?.date !== row.date || target.data.status !== 'completed')
        result.link = null;
    }
    return result;
  }
  return {
    coverage,
    refreshMatch,
    day(ownerId: string, date: string) {
      return {
        workouts: getDayRows(ownerId, date)
          .filter((row) => row.present)
          .map(visible),
        coverage: coverage(ownerId, date, date)[0] ?? {
          date,
          fetchedAt: null,
          failedAt: null,
        },
      };
    },
    list(ownerId: string, from: string, to: string) {
      return db
        .select()
        .from(cardioWorkouts)
        .where(
          and(
            eq(cardioWorkouts.ownerId, ownerId),
            gte(cardioWorkouts.date, from),
            lte(cardioWorkouts.date, to),
            eq(cardioWorkouts.present, true),
          ),
        )
        .orderBy(asc(cardioWorkouts.date), asc(cardioWorkouts.id))
        .all()
        .map(visible);
    },
    find(ownerId: string, id: string) {
      const row = get(ownerId, id);
      return row?.present ? visible(row) : undefined;
    },
    saveDay(
      ownerId: string,
      date: string,
      exercises: ImportedExercise[],
      at: string,
    ) {
      db.transaction(() => {
        const seen = new Set(
          exercises.map((exercise) => 'yazio:' + exercise.providerId),
        );
        for (const row of getDayRows(ownerId, date)) {
          if (row.present && row.imported && !seen.has(row.id))
            set(row, { present: false });
        }
        for (const imported of exercises) {
          const id = 'yazio:' + imported.providerId;
          const previous = get(ownerId, id);
          if (!previous)
            db.insert(cardioWorkouts)
              .values({ ownerId, id, date, imported })
              .run();
          else if (
            !previous.present ||
            JSON.stringify(previous.imported) !== JSON.stringify(imported)
          ) {
            const moved = previous.date !== date;
            const changedKind =
              previous.imported?.strength !== imported.strength;
            const occupied =
              previous.linkId &&
              db
                .select({ id: cardioWorkouts.id })
                .from(cardioWorkouts)
                .where(
                  and(
                    eq(cardioWorkouts.ownerId, ownerId),
                    eq(cardioWorkouts.present, true),
                    eq(cardioWorkouts.linkKind, previous.linkKind!),
                    eq(cardioWorkouts.linkId, previous.linkId),
                  ),
                )
                .get()?.id;
            const resetLink =
              moved || changedKind || (occupied && occupied !== previous.id);
            set(previous, {
              date,
              imported,
              present: true,
              ...(resetLink
                ? { linkKind: null, linkId: null, automaticLink: false }
                : {}),
            });
            if (moved) refreshMatch(ownerId, previous.date);
          }
        }
        db.insert(yazioExerciseCoverage)
          .values({ ownerId, date, fetchedAt: at })
          .onConflictDoUpdate({
            target: [yazioExerciseCoverage.ownerId, yazioExerciseCoverage.date],
            set: { fetchedAt: at, failedAt: null },
          })
          .run();
        refreshMatch(ownerId, date);
      });
    },
    failDay(ownerId: string, date: string, at: string) {
      db.insert(yazioExerciseCoverage)
        .values({ ownerId, date, failedAt: at })
        .onConflictDoUpdate({
          target: [yazioExerciseCoverage.ownerId, yazioExerciseCoverage.date],
          set: { failedAt: at },
        })
        .run();
    },
    mutate(ownerId: string, command: CardioCommand) {
      if (command.kind === 'create') {
        const manual = command.input.data;
        return dto(
          db
            .insert(cardioWorkouts)
            .values({ ownerId, id: randomUUID(), date: manual.date, manual })
            .returning()
            .get(),
        );
      }
      const input = command.input;
      const row = get(ownerId, input.id);
      if (!row?.present) throw new CardioError(404);
      if (row.revision !== input.revision) throw new CardioError(409);
      if (input.kind === 'manual') {
        if (!row.manual || row.date !== input.data.date)
          throw new CardioError(400);
        return dto(set(row, { manual: input.data }));
      }
      if (!row.imported) throw new CardioError(400);
      if (input.kind === 'imported')
        return dto(
          set(row, { overrides: { ...row.overrides, ...input.overrides } }),
        );
      const target = input.target;
      if (target?.kind === 'cardio') {
        const manual = get(ownerId, target.id);
        if (
          !manual?.manual ||
          !manual.present ||
          manual.date !== row.date ||
          row.imported.strength
        )
          throw new CardioError(409);
      }
      if (target?.kind === 'strength') {
        const strength = getTarget(ownerId, target.id);
        if (
          !row.imported.strength ||
          strength?.date !== row.date ||
          strength.data.status !== 'completed'
        )
          throw new CardioError(409);
      }
      if (
        target &&
        getDayRows(ownerId, row.date).some(
          (other) =>
            other.id !== row.id &&
            other.present &&
            other.linkKind === target.kind &&
            other.linkId === target.id,
        )
      )
        throw new CardioError(409);
      const saved = set(row, {
        linkKind: target?.kind ?? null,
        linkId: target?.id ?? null,
        automaticLink: false,
        suppressMatch: !target,
      });
      refreshMatch(ownerId, row.date);
      return dto(saved);
    },
  };
}
