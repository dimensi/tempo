'use client';
import { useCallback, useState, type SetStateAction } from 'react';
import { readSession } from './session-state';
const prefix = 'tempo:view:';
const limit = 100;
/** Explicitly used only by non-secret drafts/disclosures, never credentials. */
export function useViewState<T>(key: string, initial: T | (() => T)) {
  const storageKey = `${prefix}${readSession()?.partition ?? ''}:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved !== null) return JSON.parse(saved) as T;
      } catch {
        /* Fall back to the current form. */
      }
    }
    return initial instanceof Function ? initial() : initial;
  });
  const update = useCallback(
    (next: SetStateAction<T>) =>
      setValue((previous) => {
        const result = next instanceof Function ? next(previous) : next;
        try {
          const body = JSON.stringify(result);
          if (body === undefined) sessionStorage.removeItem(storageKey);
          else if (body.length <= 32768) {
            sessionStorage.removeItem(storageKey);
            sessionStorage.setItem(storageKey, body);
            const keys = Object.keys(sessionStorage).filter((name) =>
              name.startsWith(prefix),
            );
            for (const name of keys.slice(0, Math.max(0, keys.length - limit)))
              sessionStorage.removeItem(name);
          }
        } catch {
          /* Storage refusal must not discard entered values. */
        }
        return result;
      }),
    [storageKey],
  );
  return [value, update] as const;
}
