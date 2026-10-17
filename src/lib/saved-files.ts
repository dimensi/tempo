import { browserStore } from './browser-storage';
import { apiFetch } from './api-client';
import {
  OfflineStorage,
  offlineFileLimits,
  subscribeSessionReset,
  type StoredOfflineFile,
} from './offline-device';
import { readSession, sessionGeneration } from './session-state';
const filesRemovedEvent = 'tempo:saved-files-removed';
const empty = { files: [] as StoredOfflineFile[], ready: false };
class SavedFiles {
  private state = empty;
  private generation = 0;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  getServerSnapshot = () => empty;
  private onStorage = (event: StorageEvent) => {
    if (event.key !== filesRemovedEvent || !event.newValue) return;
    try {
      const change = JSON.parse(event.newValue);
      if (
        typeof change.partition === 'string' &&
        change.partition === readSession()?.partition
      )
        this.clear();
    } catch {
      /* Ignore malformed cross-tab notifications. */
    }
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1)
      window.addEventListener('storage', this.onStorage);
    const stop = subscribeSessionReset(() => this.set(empty));
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size)
        window.removeEventListener('storage', this.onStorage);
      stop();
    };
  };
  private set(state: typeof empty) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  clear() {
    this.generation++;
    this.set({ files: [], ready: true });
  }
  async load() {
    const partition = readSession()?.partition;
    const generation = sessionGeneration();
    const localGeneration = this.generation;
    if (!partition) return;
    const files = await new OfflineStorage().files(partition);
    if (
      generation === sessionGeneration() &&
      localGeneration === this.generation
    )
      this.set({ files, ready: true });
  }
  private url(href: string) {
    const url = new URL(href, location.origin);
    if (
      url.origin !== location.origin ||
      !(
        url.pathname === '/api/reports' ||
        /^\/api\/anamnesis\/(?:documents|reports)\/[^/]+\/file$/.test(
          url.pathname,
        ) ||
        /^\/api\/workouts\/(?:videos\/[A-Za-z0-9-]+\/playback|transformmate\/exercises\/[1-9][0-9]*\/video)$/.test(
          url.pathname,
        )
      )
    )
      throw new Error('File unavailable');
    return url;
  }
  async saveFile(input: {
    id: string;
    label: string;
    href: string;
    kind: 'pdf' | 'video';
    size?: number;
    signal?: AbortSignal;
  }) {
    const partition = readSession()?.partition;
    const generation = sessionGeneration();
    const localGeneration = this.generation;
    if (!partition) throw new Error('Session unavailable');
    if (input.size && input.size > offlineFileLimits.singleBytes)
      throw new Error('File too large');
    const response = await apiFetch(this.url(input.href), {
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(120000)])
        : AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error('File unavailable');
    const bytes = await response.blob();
    if (
      generation !== sessionGeneration() ||
      localGeneration !== this.generation
    )
      throw new Error('Local data changed');
    if (
      !bytes.size ||
      bytes.size > offlineFileLimits.singleBytes ||
      (input.size !== undefined && input.size !== bytes.size) ||
      bytes.type !== (input.kind === 'pdf' ? 'application/pdf' : 'video/mp4')
    )
      throw new Error('Invalid file');
    await new OfflineStorage().writeFile(
      {
        id: input.id,
        label: input.label,
        kind: input.kind,
        bytes,
        savedAt: Date.now(),
        fence: { partition, generation: 0, deviceEpoch: '' },
      },
      () =>
        generation === sessionGeneration() &&
        localGeneration === this.generation,
    );
    await this.load();
  }
  async removeAll() {
    const partition = readSession()?.partition;
    const generation = sessionGeneration();
    if (!partition) throw new Error('Session unavailable');
    const localGeneration = ++this.generation;
    const isCurrent = () =>
      generation === sessionGeneration() && localGeneration === this.generation;
    await browserStore<void>(['files'], 'readwrite', (tx) => {
      const request = tx.objectStore('files').openCursor();
      request.onsuccess = () => {
        if (!isCurrent()) {
          tx.abort();
          return;
        }
        const cursor = request.result;
        if (!cursor) return;
        const file = cursor.value as StoredOfflineFile;
        if (file.fence.partition === partition) cursor.delete();
        cursor.continue();
      };
    });
    if (isCurrent()) {
      this.set({ files: [], ready: true });
      try {
        localStorage.setItem(
          filesRemovedEvent,
          JSON.stringify({ partition, nonce: crypto.randomUUID() }),
        );
      } catch {
        /* Local removal succeeds when cross-tab storage is unavailable. */
      }
    }
  }
  async removeFile(id: string) {
    const partition = readSession()?.partition;
    if (!partition) return;
    await new OfflineStorage().writeFile({
      id,
      fence: { partition, generation: 0, deviceEpoch: '' },
    });
    await this.load();
  }
}
export const savedFiles = new SavedFiles();
