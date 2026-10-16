/** Reuse equal records without touching a reader's mutable form state. */
export function reconcileRead<T>(previous: T | undefined, next: T): T {
  if (Object.is(previous, next)) return next;
  if (
    !previous ||
    !next ||
    typeof previous !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(previous) !== Array.isArray(next)
  )
    return next;
  if (Array.isArray(previous) && Array.isArray(next)) {
    const identified = new Map(
      previous.flatMap((value) =>
        value && typeof value === 'object' && 'id' in value
          ? [[value.id, value] as const]
          : [],
      ),
    );
    let same = previous.length === next.length;
    for (let index = 0; index < next.length; index++) {
      const value = next[index];
      const before =
        value && typeof value === 'object' && 'id' in value
          ? identified.get(value.id)
          : previous[index];
      next[index] = reconcileRead(before, value);
      if (!Object.is(previous[index], next[index])) same = false;
    }
    return same ? previous : next;
  }
  const keys = Object.keys(next);
  let same = Object.keys(previous).length === keys.length;
  for (const key of keys) {
    const value = reconcileRead(
      Reflect.get(previous, key),
      Reflect.get(next, key),
    );
    if (
      !Object.is(value, Reflect.get(previous, key)) ||
      !Object.hasOwn(previous, key)
    )
      same = false;
    Reflect.set(next, key, value);
  }
  return same ? previous : next;
}
