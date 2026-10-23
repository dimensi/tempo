'use client';
import { useEffect, useState } from 'react';
import { readDeviceWrites } from '@/lib/offline-write-client';
import { subscribeSessionReset } from '@/lib/offline-device';
import { sessionGeneration } from '@/lib/session-state';

// Unknown queue state blocks destructive actions until the account-scoped read finishes.
export function usePendingWorkoutWrites(
  recordId: string | undefined,
  enabled: boolean,
) {
  const [state, setState] = useState<{ id: string; pending: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!enabled || !recordId) return;
    let disposed = false;
    let request = 0;
    const refresh = () => {
      const serial = ++request;
      const generation = sessionGeneration();
      void readDeviceWrites()
        .then((writes) => {
          if (
            disposed ||
            serial !== request ||
            generation !== sessionGeneration()
          )
            return;
          setState({
            id: recordId,
            pending: writes.operations.some(
              (item) =>
                item.operation.recordId === recordId &&
                item.status !== 'synced',
            ),
          });
        })
        .catch(() => {
          if (!disposed && serial === request)
            setState({ id: recordId, pending: true });
        });
    };
    refresh();
    window.addEventListener('offline-writes-changed', refresh);
    const unsubscribe = subscribeSessionReset(() => {
      ++request;
      setState(null);
    });
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener('offline-writes-changed', refresh);
    };
  }, [recordId, enabled]);
  return enabled && !!recordId && (state?.id !== recordId || state.pending);
}
