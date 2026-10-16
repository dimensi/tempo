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
