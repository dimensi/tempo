import type { ReadContext } from '@/contracts/read-context';
import { notifySessionReset } from './offline-device';
let current: ReadContext | undefined;
let generation = 0;
export function readSession() {
  return current;
}
export function sessionGeneration() {
  return generation;
}
export function bindSession(context: ReadContext) {
  if (current?.partition !== context.partition) {
    generation++;
    current = context;
  } else current = context;
}
export function invalidateSession() {
  generation++;
  current = undefined;
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith('workout-draft:') || key.startsWith('tempo:view:'))
        sessionStorage.removeItem(key);
  } catch {
    /* Session invalidation does not depend on storage availability. */
  }
}

export function resetSession() {
  invalidateSession();
  notifySessionReset();
}
