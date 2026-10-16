'use client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { reconcileRead } from './reconcile-read';
import {
  canonicalReadKey,
  clientReads,
  bindReadScope,
  readRevalidateEvent,
  refreshClientRead,
  seedClientRead,
} from './client-read';
import { getOfflineController } from './offline-controller';
import { type ReadResource } from './read-resource';

export interface ReadDescriptor<T> {
  href: string | undefined;
  parse: (value: unknown) => T;
}
/** One subscription for memory, fenced disk restoration and fresh responses. */
export function useReadResource<T>(
  descriptor: ReadDescriptor<T>,
  initialSeed?: T,
) {
  const { href } = descriptor;
  const [parse] = useState(() => {
    let previous: T | undefined;
    return (body: string) => {
      previous = reconcileRead(previous, descriptor.parse(JSON.parse(body)));
      return previous;
    };
  });
  const key = href
    ? canonicalReadKey(new URL(href, 'https://tempo.local'))
    : '';
  const subscribe = useMemo(
    () => (listener: () => void) => clientReads.subscribe(key, listener),
    [key],
  );
  const snapshot = useMemo(() => () => clientReads.snapshot(key), [key]);
  const state = useSyncExternalStore(subscribe, snapshot, emptySnapshot);
  const parsed = useMemo(() => {
    if (state.data === undefined) return undefined;
    try {
      return parse(state.data);
    } catch {
      return undefined;
    }
  }, [state.data, parse]);
  const refresh = useMemo(
    () => async () => {
      if (!key) return;
      bindReadScope();
      await clientReads.restore(key);
      await refreshClientRead(key).catch(() => {});
    },
    [key],
  );
  useEffect(() => {
    if (!key) return;
    const restore = () => {
      bindReadScope();
      if (
        initialSeed !== undefined &&
        clientReads.snapshot(key).data === undefined
      )
        void seedClientRead(key, initialSeed);
      void clientReads.restore(key);
    };
    let readyScope = '';
    const controller = getOfflineController();
    const update = () => {
      restore();
      const bundle = controller.getSnapshot().bundle;
      const next = bundle
        ? `${bundle.fence.partition}:${bundle.fence.deviceEpoch}:${bundle.snapshot.connectionGeneration}`
        : '';
      // Progress notifications within one scope do not start another network
      // read or feed source-loaded -> snapshot-save -> read loops.
      if (next && next !== readyScope) {
        readyScope = next;
        void refresh();
      }
    };
    update();
    const stop = controller.subscribe(update);
    if (!readyScope) void refresh();
    window.addEventListener(readRevalidateEvent, refresh);
    return () => {
      stop();
      window.removeEventListener(readRevalidateEvent, refresh);
    };
  }, [key, initialSeed, refresh]);
  return {
    data: parsed ?? initialSeed,
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
const emptySnapshot = () => empty;
