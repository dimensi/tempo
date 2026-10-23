import { z } from 'zod';
import type { Workout } from '@/contracts/workouts';
import { workoutDraftSchema } from './workout-draft';

const envelope = z
  .object({ savedAt: z.number(), requestId: z.uuid(), value: z.unknown() })
  .strict();
const lifetime = 12 * 60 * 60 * 1000;
const needsReview = (value: unknown) =>
  typeof value === 'object' &&
  value !== null &&
  (('plan' in value && 'result' in value) ||
    ('revision' in value && value.revision === -1));
const prefix = 'workout-draft:';
const validTime = (savedAt: number) =>
  savedAt <= Date.now() && Date.now() - savedAt < lifetime;

export function dayWorkoutDraftKey(
  identity: string,
  date: string,
  recordId: string,
  workoutId = '',
) {
  return `${prefix}${identity}:day:${recordId}:${workoutId}:${date}`;
}

export function clearWorkoutDraft(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Storage may be disabled. */
  }
}
export function clearWorkoutDrafts() {
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(prefix)) sessionStorage.removeItem(key);
  } catch {
    /* Storage may be disabled. */
  }
}
/** Restore only the current user partition. Values never enter a URL. */
export function readWorkoutDraft<T>(
  key: string,
  identity: string,
  schema: z.ZodType<T>,
) {
  try {
    for (const storedKey of Object.keys(sessionStorage)) {
      if (!storedKey.startsWith(prefix)) continue;
      let valid = false;
      try {
        const raw = sessionStorage.getItem(storedKey);
        const parsed =
          raw && raw.length <= 256_000
            ? envelope.safeParse(JSON.parse(raw))
            : null;
        valid =
          storedKey.startsWith(`${prefix}${identity}:`) &&
          Boolean(
            parsed?.success &&
            (validTime(parsed.data.savedAt) || needsReview(parsed.data.value)),
          );
      } catch {
        /* Remove malformed entries without stopping restoration. */
      }
      if (!valid) sessionStorage.removeItem(storedKey);
    }
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = envelope
      .extend({ value: schema })
      .safeParse(JSON.parse(raw));
    if (
      !parsed.success ||
      (!validTime(parsed.data.savedAt) && !needsReview(parsed.data.value))
    ) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}
export function storeWorkoutDraft(
  key: string,
  requestId: string,
  value: unknown,
): boolean {
  try {
    const serialized = JSON.stringify({
      savedAt: Date.now(),
      requestId,
      value,
    });
    if (serialized.length > 256_000) {
      return false;
    }
    const others = Object.keys(sessionStorage).filter(
      (item) => item.startsWith(prefix) && item !== key,
    );
    const protectedDraft = (item: string) => {
      try {
        return needsReview(
          envelope.parse(JSON.parse(sessionStorage.getItem(item)!)).value,
        );
      } catch {
        return false;
      }
    };
    const age = (item: string) => {
      try {
        return envelope.parse(JSON.parse(sessionStorage.getItem(item)!))
          .savedAt;
      } catch {
        return 0;
      }
    };
    others.sort((a, b) => age(a) - age(b));
    while (others.length >= 8) {
      const disposable = others.findIndex((item) => !protectedDraft(item));
      // Keep unresolved alternatives, but never grow the bounded draft store.
      if (disposable === -1) return false;
      sessionStorage.removeItem(others.splice(disposable, 1)[0]!);
    }
    sessionStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

/** Convert a legacy envelope once, retaining partial inputs and requiring review. */
export function readLegacyWorkoutDraft(
  identity: string,
  date: string,
  workout?: Workout,
) {
  try {
    const candidates = Object.keys(sessionStorage).filter(
      (key) =>
        key.startsWith(`${prefix}${identity}:day:`) && key.endsWith(`:${date}`),
    );
    for (const key of candidates) {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      const parsed = envelope.safeParse(JSON.parse(raw));
      if (!parsed.success) continue;
      const legacy = z
        .object({
          plan: z.object({
            title: z.string(),
            description: z.string(),
            workouts: z.array(
              z.object({
                id: z.string(),
                date: z.string(),
                title: z.string(),
                exercises: z.array(z.unknown()),
              }),
            ),
          }),
          result: z.unknown(),
          planDirty: z.boolean(),
          resultDirty: z.boolean(),
        })
        .safeParse(parsed.data.value);
      if (!legacy.success) continue;
      const old = legacy.data;
      const sessionKey = !!workout && key.includes(`:day:${workout.id}::`);
      const legacySource = workout?.legacySource;
      if (
        legacySource &&
        !sessionKey &&
        !key.includes(`:day:${legacySource.planId}:${legacySource.workoutId}:`)
      )
        continue;
      const planned = old.plan.workouts.find(
        (item) =>
          item.date === date &&
          (!workout || item.id === (legacySource?.workoutId ?? workout.id)),
      );
      if (workout && !planned && !sessionKey) continue;
      const oldResult = z
        .object({ status: z.string() })
        .passthrough()
        .safeParse(old.result);
      const actual = workoutDraftSchema.safeParse(
        oldResult.success
          ? {
              ...oldResult.data,
              status:
                workout?.status ??
                (oldResult.data.status === 'skipped'
                  ? 'planned'
                  : oldResult.data.status),
            }
          : old.result,
      );
      const selected =
        old.resultDirty && actual.success
          ? actual.data
          : planned
            ? {
                date,
                title: planned.title || old.plan.title,
                note: old.plan.description,
                status: workout?.status ?? 'planned',
                exercises: planned.exercises,
              }
            : actual.success
              ? actual.data
              : null;
      const identify = (value: unknown) => {
        const draft = workoutDraftSchema.safeParse(value);
        if (!draft.success) return draft;
        return workoutDraftSchema.safeParse({
          ...draft.data,
          exercises: draft.data.exercises.map((exercise) => ({
            ...exercise,
            id:
              exercise.id ??
              (exercise.transformMate
                ? workout?.exercises.find(
                    (existing) =>
                      existing.transformMate?.occurrenceKey ===
                      exercise.transformMate?.occurrenceKey,
                  )?.id
                : undefined) ??
              crypto.randomUUID(),
          })),
        });
      };
      const converted = identify(selected);
      const alternative =
        old.planDirty && old.resultDirty && planned
          ? identify({
              date,
              title: planned.title || old.plan.title,
              note: old.plan.description,
              status: workout?.status ?? 'planned',
              exercises: planned.exercises,
            })
          : null;
      if (!converted.success) continue;
      const canonicalKey = dayWorkoutDraftKey(
        identity,
        date,
        workout?.id ?? 'new',
      );
      // A deliberately different base ensures explicit review before any autosave.
      if (
        storeWorkoutDraft(canonicalKey, parsed.data.requestId, {
          revision: -1,
          value: converted.data,
          ...(alternative?.success ? { alternative: alternative.data } : {}),
          legacy: parsed.data.value,
        }) &&
        key !== canonicalKey
      )
        sessionStorage.removeItem(key);
      return {
        value: converted.data,
        requestId: parsed.data.requestId,
        alternative: alternative?.success ? alternative.data : undefined,
      };
    }
  } catch {
    /* Keep the original draft for a later successful conversion. */
  }
  return null;
}
