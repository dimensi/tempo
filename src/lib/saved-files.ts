import { apiFetch } from './api-client';
import {
  OfflineStorage,
  offlineFileLimits,
  subscribeSessionReset,
  type StoredOfflineFile,
} from './offline-device';
import { readSession, sessionGeneration } from './session-state';
const empty = { files: [] as StoredOfflineFile[], ready: false };
class SavedFiles {
  private state = empty;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  getServerSnapshot = () => empty;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    const stop = subscribeSessionReset(() => this.set(empty));
    return () => {
      this.listeners.delete(listener);
      stop();
    };
  };
  private set(state: typeof empty) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  async load() {
    const partition = readSession()?.partition;
    const generation = sessionGeneration();
    if (!partition) return;
    const files = await new OfflineStorage().files(partition);
    if (generation === sessionGeneration()) this.set({ files, ready: true });
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
  async fileSize(href: string) {
    const response = await apiFetch(this.url(href), {
      method: 'HEAD',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('File unavailable');
    const size = Number(response.headers.get('content-length'));
    return Number.isSafeInteger(size) && size > 0 ? size : null;
  }
  async saveFile(input: {
    id: string;
    label: string;
    href: string;
    kind: 'pdf' | 'video';
    size?: number;
  }) {
    const partition = readSession()?.partition;
    const generation = sessionGeneration();
    if (!partition) throw new Error('Session unavailable');
    if (input.size && input.size > offlineFileLimits.singleBytes)
      throw new Error('File too large');
    const response = await apiFetch(this.url(input.href), {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error('File unavailable');
    const bytes = await response.blob();
    if (generation !== sessionGeneration()) throw new Error('Session changed');
    if (
      !bytes.size ||
      bytes.size > offlineFileLimits.singleBytes ||
      (input.size !== undefined && input.size !== bytes.size) ||
      bytes.type !== (input.kind === 'pdf' ? 'application/pdf' : 'video/mp4')
    )
      throw new Error('Invalid file');
    await new OfflineStorage().writeFile({
      id: input.id,
      label: input.label,
      kind: input.kind,
      bytes,
      savedAt: Date.now(),
      fence: { partition, generation: 0, deviceEpoch: '' },
    });
    await this.load();
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
