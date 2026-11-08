'use client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  bindReadScope,
  canonicalReadKey,
  clientReads,
  readRevalidateEvent,
  refreshClientRead,
  seedClientRead,
} from './client-read';
import type { ReadDescriptor } from './read-descriptors';
import type { ReadResource } from './read-resource';
import { sessionGeneration } from './session-state';
export function useReadResource<T>(
  resource: ReadDescriptor<T>,
  initialSeed?: T,
) {
  const key = resource.href
    ? canonicalReadKey(new URL(resource.href, 'https://tempo.local'))
    : '';
  const [decode] = useState(() => {
    let previous: T | undefined;
    return (body: string) => (previous = resource.decode(body, previous));
  });
  const subscribe = useMemo(
    () => (listener: () => void) => clientReads.subscribe(key, listener),
    [key],
  );
  const snapshot = useMemo(() => () => clientReads.snapshot(key), [key]);
  const state = useSyncExternalStore(subscribe, snapshot, () => empty);
  const data = useMemo(() => {
    if (state.data === undefined) return undefined;
    try {
      return decode(state.data);
    } catch {
      return undefined;
    }
  }, [state.data, decode]);
  const refresh = useMemo(
    () =>
      async (afterCurrent = false) => {
        if (!key) return;
        const generation = sessionGeneration();
        bindReadScope();
        await clientReads.restore(key);
        if (afterCurrent) await clientReads.waitForCurrentRead(key);
        if (generation !== sessionGeneration()) return;
        await refreshClientRead(key).catch(() => {});
      },
    [key],
  );
  useEffect(() => {
    if (!key) return;
    bindReadScope();
    if (
      initialSeed !== undefined &&
      clientReads.snapshot(key).data === undefined
    )
      void seedClientRead(key, initialSeed);
    void refresh();
    const revalidate = (event: Event) =>
      void refresh(event instanceof CustomEvent && event.detail === true);
    window.addEventListener(readRevalidateEvent, revalidate);
    return () => window.removeEventListener(readRevalidateEvent, revalidate);
  }, [key, initialSeed, refresh]);
  return {
    data: data ?? initialSeed,
    coverage: state.coverage,
    refreshing: state.refreshing,
    error: state.error,
    refresh,
  };
}
const empty: ReadResource<string> = Object.freeze({
  coverage: 'missing',
  refreshing: false,
});
