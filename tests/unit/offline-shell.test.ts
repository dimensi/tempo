import { afterEach, expect, test, vi } from 'vitest';
import { prepareOfflineShell } from '@/features/offline/shell';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test('abort releases pending registration without waiting for public installation', async () => {
  vi.useFakeTimers();
  const registration = deferred();
  const ready = vi.fn(() => Promise.resolve());
  const worker = {
    register: vi.fn(() => registration.promise),
    get ready() {
      return ready();
    },
  };
  vi.stubGlobal('navigator', { serviceWorker: worker });
  const operation = new AbortController();
  const pending = prepareOfflineShell(operation.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  await Promise.resolve();
  expect(worker.register).toHaveBeenCalledOnce();
  operation.abort();
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  registration.resolve();
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
});
test('abort releases a pending ready wait and removes its listener and deadline', async () => {
  vi.useFakeTimers();
  const ready = deferred();
  const readReady = vi.fn(() => ready.promise);
  vi.stubGlobal('navigator', {
    serviceWorker: {
      register: () => Promise.resolve(),
      get ready() {
        return readReady();
      },
    },
  });
  const operation = new AbortController();
  const remove = vi.spyOn(operation.signal, 'removeEventListener');
  const pending = prepareOfflineShell(operation.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(readReady).toHaveBeenCalledOnce();
  operation.abort();
  await rejected;
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});
test('availability retains a ten-second bound even if registration never settles', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', {
    serviceWorker: { register: () => new Promise(() => {}) },
  });
  const rejected = expect(
    prepareOfflineShell(new AbortController().signal),
  ).rejects.toThrow('Offline shell unavailable');
  await vi.advanceTimersByTimeAsync(10000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
test('successful readiness cleans the deadline and already-aborted work never registers', async () => {
  vi.useFakeTimers();
  const register = vi.fn(() => Promise.resolve());
  vi.stubGlobal('navigator', {
    serviceWorker: { register, ready: Promise.resolve() },
  });
  await prepareOfflineShell(new AbortController().signal);
  expect(vi.getTimerCount()).toBe(0);
  const operation = new AbortController();
  operation.abort();
  await expect(prepareOfflineShell(operation.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(register).toHaveBeenCalledOnce();
});
