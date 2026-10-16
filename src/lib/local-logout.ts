import { clearLocalData } from './local-data';
import { resetSession } from './session-state';
const logoutKey = 'tempo:logout-pending';
let memoryIntent = false;
export function hasPendingLogout() {
  try {
    return memoryIntent || localStorage.getItem(logoutKey) === 'true';
  } catch {
    return memoryIntent;
  }
}
export function beginLocalLogout() {
  memoryIntent = true;
  try {
    localStorage.setItem(logoutKey, 'true');
  } catch {
    // A storage refusal still permits local reset and server sign-out.
  } finally {
    resetSession();
  }
}
let flight: Promise<boolean> | undefined;
export function finishPendingLogout() {
  if (!hasPendingLogout()) return Promise.resolve(true);
  if (!navigator.onLine) return Promise.resolve(false);
  return (flight ??= (async () => {
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return false;
      memoryIntent = false;
      localStorage.removeItem(logoutKey);
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    flight = undefined;
  }));
}
export async function clearClientData() {
  resetSession();
  try {
    localStorage.setItem('tempo:session-reset', crypto.randomUUID());
  } catch {
    /* Local reset still applies when storage is unavailable. */
  }
  await clearLocalData();
}
export async function endClientSession(deleteWrites: boolean) {
  beginLocalLogout();
  try {
    await clearClientData();
    if (deleteWrites) {
      const { withWriteLock, deleteDeviceWrites } =
        await import('./offline-write-client');
      await withWriteLock(deleteDeviceWrites);
    }
  } finally {
    await finishPendingLogout();
  }
}

/** Coordinate the pending-write choice with both local saves and cross-tab sending. */
export async function requestLocalLogout(
  discard = false,
): Promise<'pending' | 'done'> {
  const {
    withWriteLock,
    hasPendingDeviceWrites,
    deleteDeviceWrites,
    cancelDeviceSync,
  } = await import('./offline-write-client');
  cancelDeviceSync();
  const finish = () =>
    withWriteLock(async () => {
      if (!discard && (await hasPendingDeviceWrites()))
        return 'pending' as const;
      beginLocalLogout();
      try {
        await deleteDeviceWrites();
      } finally {
        await endClientSession(false);
      }
      return 'done' as const;
    });
  return navigator.locks
    ? navigator.locks.request(
        'yazio-offline-mutation',
        { mode: 'exclusive' },
        finish,
      )
    : finish();
}
