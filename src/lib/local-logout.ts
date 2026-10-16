import { notifyOfflineBlocked } from './offline-device';
const logoutKey = 'tempo:logout-pending';
export function hasPendingLogout() {
  try {
    return localStorage.getItem(logoutKey) === 'true';
  } catch {
    return false;
  }
}
export function beginLocalLogout() {
  // Durable intent precedes any asynchronous cleanup or server request.
  try {
    localStorage.setItem(logoutKey, 'true');
  } finally {
    notifyOfflineBlocked();
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
      localStorage.removeItem(logoutKey);
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    flight = undefined;
  }));
}
