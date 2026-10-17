import { z } from 'zod';

const envelope = z
  .object({ savedAt: z.number(), requestId: z.uuid(), value: z.unknown() })
  .strict();
const lifetime = 12 * 60 * 60 * 1000;
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
          Boolean(parsed?.success && validTime(parsed.data.savedAt));
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
    if (!parsed.success || !validTime(parsed.data.savedAt)) {
      sessionStorage.removeItem(key);
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
      sessionStorage.removeItem(key);
      return false;
    }
    const others = Object.keys(sessionStorage).filter(
      (item) => item.startsWith(prefix) && item !== key,
    );
    const age = (item: string) => {
      try {
        return envelope.parse(JSON.parse(sessionStorage.getItem(item)!))
          .savedAt;
      } catch {
        return 0;
      }
    };
    others.sort((a, b) => age(a) - age(b));
    while (others.length >= 8) sessionStorage.removeItem(others.shift()!);
    sessionStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}
