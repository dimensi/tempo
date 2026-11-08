import { useEffect, useState } from 'react';
import type { NutritionLiveStatus } from '@/contracts/nutrition-sync';
import {
  fetchNutritionSyncStatus,
  nutritionSyncRequested,
  nutritionSyncRequestEvent,
} from './api-client';
import { revalidateVisibleReads } from './client-read';
import { sessionGeneration } from './session-state';
import { useReadOnline } from './use-read-online';

export function useNutritionSyncStatus(enabled: boolean) {
  const online = useReadOnline();
  const [status, setStatus] = useState<{
    generation: number;
    value: NutritionLiveStatus;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !online) return;
    const controller = new AbortController();
    const generation = sessionGeneration();
    let previous: NutritionLiveStatus | undefined;
    let flight = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      clearTimeout(timer);
      if (flight || document.visibilityState !== 'visible') return;
      flight = true;
      try {
        const next = await fetchNutritionSyncStatus(
          AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        );
        if (controller.signal.aborted || generation !== sessionGeneration())
          return;
        const changed = previous
          ? previous.activity?.id !== next.activity?.id ||
            previous.activity?.revision !== next.activity?.revision ||
            previous.last.finishedAt !== next.last.finishedAt
          : !!next.activity?.revision || !!next.last.finishedAt;
        previous = next;
        setStatus({ generation, value: next });
        if (changed) revalidateVisibleReads(true);
      } catch {
        if (!controller.signal.aborted) setStatus(null);
      } finally {
        flight = false;
        if (
          !controller.signal.aborted &&
          document.visibilityState === 'visible'
        )
          timer = setTimeout(
            poll,
            previous?.activity || nutritionSyncRequested() ? 2000 : 30000,
          );
      }
    }
    void poll();
    window.addEventListener(nutritionSyncRequestEvent, poll);
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', poll);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener(nutritionSyncRequestEvent, poll);
      window.removeEventListener('focus', poll);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [enabled, online]);
  return enabled && online && status?.generation === sessionGeneration()
    ? status.value
    : null;
}
