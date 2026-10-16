'use client';
import { LoginForm } from '@/components/shared/login-form';
import type { ReadContext } from '@/contracts/read-context';
import { readContextSchema } from '@/contracts/read-context';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from './api-client';
import { observeReadResources, revalidateVisibleReads } from './client-read';
import { finishPendingLogout, hasPendingLogout } from './local-logout';
import { subscribeSessionReset } from './offline-device';
import { syncDeviceWrites } from './offline-write-client';
import {
  bindSession,
  invalidateSession,
  sessionGeneration,
} from './session-state';
const Context = createContext<ReadContext | null>(null);
export function useReadContext() {
  const value = useContext(Context);
  if (!value) throw new Error('Read session provider missing');
  return value;
}
export function ClientSession({
  initial,
  children,
}: {
  initial: ReadContext;
  children: ReactNode;
}) {
  const [loggedOut, setLoggedOut] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (hasPendingLogout()) return true;
    bindSession(initial);
    return false;
  });
  useEffect(() => {
    const stopReads = observeReadResources();
    const stop = subscribeSessionReset(() => {
      invalidateSession();
      setLoggedOut(true);
    });
    let flight: Promise<void> | undefined;
    let closed = false;
    const refresh = () => {
      if (closed || document.visibilityState === 'hidden') return;
      if (hasPendingLogout()) {
        setLoggedOut(true);
        void finishPendingLogout().then((done) => {
          if (done && !closed) location.replace('/login');
        });
        return;
      }
      const generation = sessionGeneration();
      flight ??= (async () => {
        try {
          const response = await apiFetch('/api/read/context', {
            cache: 'no-store',
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok || closed || generation !== sessionGeneration())
            return;
          const context = readContextSchema.parse(await response.json());
          if (closed || generation !== sessionGeneration()) return;
          if (context.partition !== initial.partition) {
            const { endClientSession } = await import('./local-logout');
            if (closed || generation !== sessionGeneration()) return;
            await endClientSession(false);
            if (navigator.onLine) location.replace('/login');
            return;
          }
          bindSession(context);
          revalidateVisibleReads();
          if (context.role === 'OWNER') await syncDeviceWrites();
        } catch {
          /* An unreachable server does not revoke cached data. */
        }
      })().finally(() => {
        flight = undefined;
      });
    };
    const synced = (event: StorageEvent) => {
      if (event.key === 'tempo:writes-synced' && !hasPendingLogout())
        revalidateVisibleReads();
    };
    window.addEventListener('storage', synced);
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(() => {
      if (
        initial.role === 'OWNER' &&
        navigator.onLine &&
        document.visibilityState === 'visible'
      )
        void syncDeviceWrites().catch(() => {});
    }, 15000);
    return () => {
      closed = true;
      stop();
      stopReads();
      clearInterval(timer);
      window.removeEventListener('storage', synced);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [initial]);
  return (
    <Context.Provider value={initial}>
      {loggedOut ? (
        <main>
          <LoginForm />
        </main>
      ) : (
        children
      )}
    </Context.Provider>
  );
}
