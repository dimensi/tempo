import {
  offlineIdentitySchema,
  offlineSnapshotSchema,
  offlineLimits,
  type OfflineIdentity,
  type OfflineSnapshot,
} from '@/contracts/offline';
import {
  mergeOfflineSnapshots,
  offlineLocalWindow,
} from '@/contracts/offline-retention';
import { ownerConfirmedYazioWeightPolicyVersion } from '@/contracts/yazio-weight-policy';
import {
  withOfflineCacheLock,
  OfflineStorage,
  OfflineStorageError,
  purgeOfflineDevice,
  subscribeOfflineBlocked,
  offlineDeviceLimits,
  type CachedBundle,
  type StoredPhoto,
} from '@/lib/offline-device';
import { prepareOfflineShell } from './shell';
export interface OfflineState {
  status: 'checking' | 'disabled' | 'saving' | 'ready' | 'offline' | 'error';
  enabled: boolean;
  bundle: CachedBundle<OfflineSnapshot> | null;
  photos: StoredPhoto[];
  error: 'unavailable' | 'denied' | null;
}
const empty: OfflineState = {
  status: 'checking',
  enabled: false,
  bundle: null,
  photos: [],
  error: null,
};
export class OfflineReadError extends Error {
  constructor(public readonly reason: 'unavailable' | 'denied') {
    super(`Offline read ${reason}`);
  }
}
export class OfflineController {
  private state: OfflineState = empty;
  private listeners = new Set<() => void>();
  private revision = 0;
  private pending?: AbortController;
  private flight?: Promise<void>;
  private flightRevision = -1;
  private flightOnline = false;
  private optedIn = false;
  private lastVerifiedAt = 0;
  private lastRefreshAttempt = Number.NEGATIVE_INFINITY;
  constructor(
    private readonly storage = new OfflineStorage(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now,
    private readonly prepareShell = prepareOfflineShell,
    private readonly timezone = () =>
      Intl.DateTimeFormat().resolvedOptions().timeZone,
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
    this.state = { ...state, enabled: this.optedIn };
    for (const listener of this.listeners) listener();
  }
  invalidate = () => {
    this.revision++;
    this.pending?.abort();
    this.lastVerifiedAt = 0;
    this.set({ ...empty, status: 'disabled' });
  };
  private block = () => {
    this.optedIn = false;
    this.invalidate();
  };
  private begin(status: OfflineState['status']) {
    this.pending?.abort();
    this.pending = new AbortController();
    const revision = ++this.revision;
    this.set({ ...empty, status });
    return {
      revision,
      signal: AbortSignal.any([
        this.pending.signal,
        AbortSignal.timeout(120000),
      ]),
    };
  }
  private async request(url: string, signal: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, url, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
    } catch {
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
  activate(online = navigator.onLine, force = false): Promise<void> {
    if (
      this.flight &&
      this.flightRevision === this.revision &&
      (!online || this.flightOnline)
    )
      return this.flight;
    const elapsed = this.now() - this.lastVerifiedAt;
    const window = offlineLocalWindow(this.now(), this.timezone());
    const previous = this.state;
    const reuse =
      !force &&
      online &&
      previous.status === 'ready' &&
      previous.bundle?.snapshot.to === window.to &&
      elapsed >= 0 &&
      elapsed < 30000;
    return this.runLocked('checking', online, async (operation) => {
      if (reuse) this.set(previous);
      else await this.load(online, operation);
    });
  }
  private runLocked(
    status: OfflineState['status'],
    online: boolean,
    work: (operation: {
      revision: number;
      signal: AbortSignal;
    }) => Promise<void>,
  ) {
    const operation = this.begin(status);
    const flight = withOfflineCacheLock(async () => {
      if (this.revision === operation.revision) await work(operation);
    })
      .then((result) => {
        if (result === 'completed' || this.revision !== operation.revision)
          return;
        this.optedIn = false;
        if (result === 'unavailable')
          this.set({ ...empty, status: 'error', error: 'unavailable' });
        else this.invalidate();
      })
      .catch((error) => this.failed(error, operation.revision));
    this.flight = flight;
    this.flightRevision = operation.revision;
    this.flightOnline = online;
    return flight.finally(() => {
      if (this.flight === flight) this.flight = undefined;
    });
  }
  private publish(
    cached: Awaited<ReturnType<OfflineStorage['read']>>,
    online: boolean,
  ) {
    this.optedIn = cached.metadata.enabled;
    this.set({
      ...empty,
      status: this.optedIn ? (online ? 'ready' : 'offline') : 'disabled',
      bundle: cached.bundle,
      photos: cached.photos,
    });
  }
  private async load(
    online: boolean,
    operation: { revision: number; signal: AbortSignal },
  ) {
    let verifiedCache: OfflineState | undefined;
    try {
      const metadata = await this.storage.metadata();
      if (this.revision !== operation.revision) return;
      this.optedIn = metadata.enabled;
      if (!metadata.enabled) {
        if (online) {
          await this.saveInsideLock(operation);
          return;
        }
        this.set({ ...empty, status: 'disabled' });
        return;
      }
      const identity = online ? await this.identity(operation.signal) : null;
      if (this.revision !== operation.revision) return;
      if (
        identity &&
        (metadata.partition !== identity.partition ||
          metadata.connectionGeneration !== identity.connectionGeneration)
      ) {
        await this.disable();
        return;
      }
      if (identity) this.lastVerifiedAt = this.now();
      const cached = await this.storage.read(this.now(), this.timezone());
      if (this.revision !== operation.revision) return;
      if (cached.bundle) {
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
        if (
          cached.photos.reduce((sum, photo) => sum + photo.bytes.size, 0) !==
            cached.bundle.photoBytes ||
          cached.photos.some(
            (photo) =>
              !(photo.bytes instanceof Blob) ||
              photo.bytes.type !== ids.get(photo.id),
          )
        )
          throw new OfflineReadError('unavailable');
      }
      this.publish(cached, online);
      verifiedCache = identity ? this.state : undefined;
      const window = offlineLocalWindow(this.now(), this.timezone());
      const copyDay = cached.bundle
        ? offlineLocalWindow(cached.bundle.savedAt, this.timezone()).to
        : null;
      const refreshDue =
        !cached.bundle ||
        copyDay !== window.to ||
        this.now() - cached.bundle.savedAt >= 300000;
      if (
        identity &&
        refreshDue &&
        this.now() - this.lastRefreshAttempt >= 300000
      )
        await this.download(identity, operation, cached);
    } catch (error) {
      await this.failed(error, operation.revision, verifiedCache);
    }
  }
  save() {
    if (
      this.flight &&
      this.flightRevision === this.revision &&
      this.state.status === 'saving'
    )
      return this.flight;
    return this.runLocked('saving', true, (operation) =>
      this.saveInsideLock(operation),
    );
  }
  private async saveInsideLock(operation: {
    revision: number;
    signal: AbortSignal;
  }) {
    this.optedIn = true;
    this.set({ ...empty, status: 'saving' });
    try {
      const identity = await this.identity(operation.signal);
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
      if (!metadata.enabled)
        await this.storage.enable(
          identity.partition,
          identity.connectionGeneration,
          this.now(),
        );
      if (this.revision !== operation.revision) return;
      this.optedIn = true;
      this.set({ ...this.state });
      const cached = await this.storage.read(this.now(), this.timezone());
      await this.download(identity, operation, cached);
    } catch (error) {
      await this.failed(error, operation.revision);
    }
  }
  private async download(
    identity: OfflineIdentity,
    operation: { revision: number; signal: AbortSignal },
    cached: Awaited<ReturnType<OfflineStorage['read']>>,
    requestedPeriod?: { from: string; to: string },
  ) {
    this.lastRefreshAttempt = this.now();
    await this.prepareShell();
    if (this.revision !== operation.revision) return;
    const fence = await this.storage.currentFence();
    const period =
      requestedPeriod ?? offlineLocalWindow(this.now(), this.timezone());
    const response = await this.request(
      `/api/offline/snapshot?from=${period.from}&to=${period.to}`,
      operation.signal,
    );
    const text = await response.text();
    if (new TextEncoder().encode(text).length > offlineLimits.payloadBytes)
      throw new OfflineStorageError('unavailable');
    const incoming = offlineSnapshotSchema.parse(JSON.parse(text));
    const snapshot = incoming;
    if (
      !this.sameIdentity(identity, snapshot) ||
      snapshot.from !== period.from ||
      snapshot.to !== period.to
    ) {
      await this.disable();
      return;
    }
    const merged = offlineSnapshotSchema.parse(
      mergeOfflineSnapshots(cached.bundle?.snapshot, snapshot),
    );
    const previousPhotos = new Map(
      cached.photos.map((photo) => [photo.id, photo.bytes]),
    );
    const previousMetadata = new Map(
      cached.bundle?.snapshot.photos.items.map((photo) => [photo.id, photo]) ??
        [],
    );
    const photos: StoredPhoto[] = [];
    const missingPhotos: string[] = [];
    let photoBytes = 0;
    for (const photo of merged.photos.items) {
      if (this.revision !== operation.revision) return;
      const remaining = offlineDeviceLimits.photoBytes - photoBytes;
      const previous = previousMetadata.get(photo.id);
      const existing =
        previous?.observedAt === photo.observedAt &&
        previous.mime === photo.mime
          ? previousPhotos.get(photo.id)
          : undefined;
      const bytes =
        existing && existing.size <= remaining
          ? existing
          : remaining > 0
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
    const bundle: CachedBundle<OfflineSnapshot> = {
      schemaVersion: 2,
      weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
      fence,
      savedAt: Date.parse(snapshot.serverNow),
      expiresAt: Date.parse(snapshot.expiresAt),
      sessionExpiresAt: Date.parse(snapshot.sessionExpiresAt),
      snapshot: merged,
      missingPhotos,
      photoBytes,
    };
    await this.storage.commit(bundle, photos, this.now(), this.timezone());
    if (this.revision !== operation.revision) return;
    const retained = await this.storage.read(this.now(), this.timezone());
    if (this.revision !== operation.revision) return;
    this.lastVerifiedAt = this.now();
    this.publish(retained, true);
  }
  private async failed(
    error: unknown,
    revision: number,
    verifiedCache?: OfflineState,
  ) {
    if (this.revision !== revision) return;
    if (error instanceof OfflineReadError && error.reason === 'denied') {
      this.optedIn = false;
      this.set({ ...empty, status: 'error', error: 'denied' });
      return;
    }
    if (
      error instanceof OfflineStorageError ||
      !(error instanceof OfflineReadError)
    ) {
      await purgeOfflineDevice().catch(() => {});
      if (this.revision === revision) {
        this.optedIn = false;
        this.set({ ...empty, status: 'error', error: 'unavailable' });
      }
      return;
    }
    this.set({
      ...(verifiedCache ?? empty),
      status: verifiedCache?.bundle ? 'ready' : 'error',
      error: 'unavailable',
    });
  }
  async saveWorkoutDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !navigator.onLine) return;
    await this.activate(true);
    if (this.flight) await this.flight;
    if (!this.state.enabled || this.state.error || this.flight) return;
    await this.runLocked('saving', true, async (operation) => {
      try {
        const identity = await this.identity(operation.signal);
        const cached = await this.storage.read(this.now(), this.timezone());
        if (this.revision !== operation.revision) return;
        await this.download(identity, operation, cached, {
          from: date,
          to: date,
        });
      } catch (error) {
        await this.failed(error, operation.revision);
      }
    });
  }
  async disable() {
    this.optedIn = false;
    this.invalidate();
    try {
      await purgeOfflineDevice();
    } catch {
      this.set({ ...empty, status: 'error', error: 'unavailable' });
    }
  }
  listen() {
    return subscribeOfflineBlocked(this.block);
  }
}
let controller: OfflineController | undefined;
export function getOfflineController() {
  return (controller ??= new OfflineController());
}
