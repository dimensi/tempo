import {
  offlineIdentitySchema,
  offlineSnapshotSchema,
  offlinePeriodSchema,
  offlineLimits,
  type OfflineIdentity,
  type OfflineSnapshot,
} from '@/contracts/offline';
import {
  OfflineStorage,
  OfflineStorageError,
  purgeOfflineDevice,
  subscribeOfflineBlocked,
  offlineDeviceLimits,
  type CachedBundle,
  type StoredPhoto,
  type CacheFence,
} from '@/lib/offline-device';
import { prepareOfflineShell } from './shell';

export interface OfflineState {
  status: 'checking' | 'disabled' | 'saving' | 'ready' | 'offline' | 'error';
  bundle: CachedBundle<OfflineSnapshot> | null;
  photos: StoredPhoto[];
  error: 'unavailable' | 'denied' | 'invalid' | null;
}
const empty: OfflineState = {
  status: 'checking',
  bundle: null,
  photos: [],
  error: null,
};
export class OfflineReadError extends Error {
  constructor(public readonly reason: 'unavailable' | 'denied' | 'invalid') {
    super(`Offline read ${reason}`);
  }
}
export class OfflineController {
  private state: OfflineState = empty;
  private listeners = new Set<() => void>();
  private revision = 0;
  private pending?: AbortController;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly storage = new OfflineStorage(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now,
    private readonly prepareShell = prepareOfflineShell,
  ) {}
  getSnapshot = () => this.state;
  getServerSnapshot = () => empty;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(state: OfflineState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  invalidate = () => {
    this.revision++;
    this.pending?.abort();
    clearTimeout(this.expiry);
    this.set({ ...empty, status: 'disabled' });
  };
  private begin(status: OfflineState['status']) {
    this.pending?.abort();
    this.pending = new AbortController();
    const revision = ++this.revision;
    this.set({ ...empty, status });
    return { revision, signal: this.pending.signal };
  }
  private async request(url: string, signal: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, url, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new OfflineReadError('unavailable');
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 409
    ) {
      await purgeOfflineDevice().catch(() => {});
      throw new OfflineReadError('denied');
    }
    if (!response.ok) throw new OfflineReadError('unavailable');
    return response;
  }
  private async identity(signal: AbortSignal) {
    return offlineIdentitySchema.parse(
      await (await this.request('/api/offline/identity', signal)).json(),
    );
  }
  private sameIdentity(first: OfflineIdentity, second: OfflineIdentity) {
    return (
      first.partition === second.partition &&
      first.connectionGeneration === second.connectionGeneration
    );
  }
  private scheduleExpiry(bundle: CachedBundle<OfflineSnapshot>) {
    clearTimeout(this.expiry);
    this.expiry = setTimeout(
      () => {
        void this.disable();
      },
      Math.max(0, bundle.expiresAt - this.now()),
    );
  }
  async activate(online = navigator.onLine) {
    const operation = this.begin('checking');
    try {
      const identity = online ? await this.identity(operation.signal) : null;
      if (this.revision !== operation.revision) return;
      const metadata = await this.storage.metadata();
      if (
        identity &&
        metadata.enabled &&
        (metadata.partition !== identity.partition ||
          metadata.connectionGeneration !== identity.connectionGeneration)
      ) {
        await this.disable();
        return;
      }
      const cached = await this.storage.read<OfflineSnapshot>(this.now());
      if (this.revision !== operation.revision) return;
      if (!cached.bundle) {
        this.set({ ...empty, status: 'disabled' });
        return;
      }
      const snapshot = offlineSnapshotSchema.parse(cached.bundle.snapshot);
      if (
        snapshot.partition !== cached.metadata.partition ||
        snapshot.connectionGeneration !==
          cached.metadata.connectionGeneration ||
        (identity && !this.sameIdentity(identity, snapshot))
      ) {
        await this.disable();
        return;
      }
      const ids = new Map(
        snapshot.photos.items.map((photo) => [photo.id, photo.mime]),
      );
      const bytes = cached.photos.reduce(
        (sum, photo) => sum + photo.bytes.size,
        0,
      );
      if (
        bytes !== cached.bundle.photoBytes ||
        cached.photos.some(
          (photo) =>
            !(photo.bytes instanceof Blob) ||
            photo.bytes.type !== ids.get(photo.id),
        )
      )
        throw new OfflineReadError('invalid');
      this.set({
        status: online ? 'ready' : 'offline',
        bundle: { ...cached.bundle, snapshot },
        photos: cached.photos,
        error: null,
      });
      this.scheduleExpiry(cached.bundle);
    } catch (error) {
      if (this.revision !== operation.revision) return;
      if (
        error instanceof OfflineStorageError ||
        !(error instanceof OfflineReadError)
      )
        await purgeOfflineDevice().catch(() => {});
      this.set({
        ...empty,
        status: 'error',
        error: error instanceof OfflineReadError ? error.reason : 'unavailable',
      });
    }
  }
  async disable() {
    this.invalidate();
    try {
      await purgeOfflineDevice();
    } catch {
      this.set({ ...empty, status: 'error', error: 'unavailable' });
    }
  }
  private async photo(
    url: string,
    mime: string,
    budget: number,
    signal: AbortSignal,
  ): Promise<Blob | null> {
    try {
      const response = await this.request(url, signal);
      if (
        response.headers.get('content-type')?.split(';')[0] !== mime ||
        !response.body
      )
        return null;
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > budget) {
          await reader.cancel();
          return null;
        }
        chunks.push(new Uint8Array(part.value));
      }
      return new Blob(chunks, { type: mime });
    } catch (error) {
      if (error instanceof OfflineReadError && error.reason === 'denied')
        throw error;
      if (signal.aborted) throw error;
      return null;
    }
  }
  async save(period: { from: string; to: string }) {
    const parsed = offlinePeriodSchema.safeParse(period);
    if (!parsed.success) {
      this.set({ ...empty, status: 'error', error: 'invalid' });
      return;
    }
    const operation = this.begin('saving');
    try {
      const identity = await this.identity(operation.signal);
      if (this.revision !== operation.revision) return;
      await this.prepareShell();
      if (this.revision !== operation.revision) return;
      const metadata = await this.storage.metadata();
      if (
        metadata.enabled &&
        (metadata.partition !== identity.partition ||
          metadata.connectionGeneration !== identity.connectionGeneration)
      ) {
        await this.disable();
        return;
      }
      const fence: CacheFence = metadata.enabled
        ? await this.storage.currentFence()
        : await this.storage.enable(
            identity.partition,
            identity.connectionGeneration,
            this.now(),
          );
      if (this.revision !== operation.revision) return;
      const response = await this.request(
        `/api/offline/snapshot?from=${parsed.data.from}&to=${parsed.data.to}`,
        operation.signal,
      );
      const text = await response.text();
      if (new TextEncoder().encode(text).length > offlineLimits.payloadBytes)
        throw new OfflineReadError('invalid');
      const snapshot = offlineSnapshotSchema.parse(JSON.parse(text));
      if (
        !this.sameIdentity(identity, snapshot) ||
        snapshot.from !== period.from ||
        snapshot.to !== period.to
      ) {
        await this.disable();
        return;
      }
      const photos: StoredPhoto[] = [];
      const missingPhotos: string[] = [];
      let photoBytes = 0;
      for (const photo of snapshot.photos.items) {
        if (this.revision !== operation.revision) return;
        const remaining = offlineDeviceLimits.photoBytes - photoBytes;
        const bytes =
          remaining > 0
            ? await this.photo(
                photo.downloadUrl,
                photo.mime,
                remaining,
                operation.signal,
              )
            : null;
        if (bytes) {
          photoBytes += bytes.size;
          photos.push({ id: photo.id, bytes });
        } else missingPhotos.push(photo.id);
      }
      const finalIdentity = await this.identity(operation.signal);
      if (this.revision !== operation.revision) return;
      if (!this.sameIdentity(snapshot, finalIdentity)) {
        await this.disable();
        return;
      }
      const savedAt = Date.parse(snapshot.serverNow);
      const sessionExpiresAt = Math.min(
        Date.parse(snapshot.sessionExpiresAt),
        Date.parse(finalIdentity.sessionExpiresAt),
      );
      const bundle = {
        schemaVersion: 1 as const,
        fence,
        savedAt,
        sessionExpiresAt,
        expiresAt: Math.min(
          Date.parse(snapshot.expiresAt),
          Date.parse(finalIdentity.expiresAt),
          savedAt + offlineDeviceLimits.lifetimeMs,
          sessionExpiresAt,
        ),
        snapshot,
        missingPhotos,
        photoBytes,
      };
      await this.storage.commit(bundle, photos, this.now());
      if (this.revision !== operation.revision) return;
      this.set({ status: 'ready', bundle, photos, error: null });
      this.scheduleExpiry(bundle);
    } catch (error) {
      if (this.revision !== operation.revision) return;
      if (
        error instanceof OfflineStorageError ||
        !(error instanceof OfflineReadError)
      )
        await purgeOfflineDevice().catch(() => {});
      this.set({
        ...empty,
        status: 'error',
        error: error instanceof OfflineReadError ? error.reason : 'unavailable',
      });
    }
  }
  listen() {
    return subscribeOfflineBlocked(this.invalidate);
  }
}
let controller: OfflineController | undefined;
export function getOfflineController() {
  return (controller ??= new OfflineController());
}
