// New originals retain metadata only; existing compressed draft blobs remain readable.
export interface VideoDraft {
  id: string;
  name: string;
  size: number;
  lastModified?: number;
  blob?: Blob;
  duration?: number;
  uploadId?: string;
}
interface StoredVideoDraft extends VideoDraft {
  key: string;
  scope: string;
  expiresAt: number;
}
let generation = 0;

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tempo-video-upload', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      const files = db.createObjectStore('files', { keyPath: 'key' });
      files.createIndex('scope', 'scope');
      files.createIndex('expiresAt', 'expiresAt');
      if (!db.objectStoreNames.contains('drafts')) return;
      // One-time migration preserves the previous single-file draft and its TTL.
      const cursor = request.transaction!.objectStore('drafts').openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) {
          db.deleteObjectStore('drafts');
          return;
        }
        const previous = item.value as VideoDraft & { expiresAt?: number };
        if (previous.expiresAt && previous.expiresAt > Date.now()) {
          const scope = String(item.key);
          const id = previous.uploadId ?? crypto.randomUUID();
          files.put({
            ...previous,
            id,
            name: 'video.mp4',
            scope,
            key: JSON.stringify([scope, id]),
          });
        }
        item.continue();
      };
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      const transaction = db.transaction('files', 'readwrite');
      const cursor = transaction
        .objectStore('files')
        .index('expiresAt')
        .openKeyCursor(IDBKeyRange.upperBound(Date.now()));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        transaction.objectStore('files').delete(item.primaryKey);
        item.continue();
      };
      transaction.oncomplete = () => resolve(db);
      transaction.onabort = () => {
        db.close();
        reject(transaction.error ?? new Error('Draft storage unavailable'));
      };
    };
    request.onerror = () => reject(request.error);
  });
}

/** A repository from before a local reset can never write files back afterward. */
export function createVideoDraftStore(scope: string) {
  const currentGeneration = generation;
  async function run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await database();
    try {
      if (currentGeneration !== generation) throw new Error('Drafts cleared');
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction('files', mode);
        const request = action(transaction.objectStore('files'));
        transaction.oncomplete = () => {
          if (currentGeneration !== generation)
            reject(new Error('Drafts cleared'));
          else resolve(request.result);
        };
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Draft storage unavailable'));
      });
    } finally {
      db.close();
    }
  }
  return {
    async list(): Promise<VideoDraft[]> {
      const rows = (await run('readonly', (store) =>
        store.index('scope').getAll(scope),
      )) as StoredVideoDraft[];
      return rows
        .filter((row) => row.expiresAt > Date.now())
        .map(({ id, name, blob, duration, uploadId, size, lastModified }) => ({
          id,
          name,
          blob,
          duration,
          uploadId,
          size: size ?? blob?.size ?? 0,
          lastModified,
        }));
    },
    async save(value: VideoDraft): Promise<void> {
      await run('readwrite', (store) =>
        store.put({
          ...value,
          scope,
          key: JSON.stringify([scope, value.id]),
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        } satisfies StoredVideoDraft),
      );
    },
    async remove(id: string): Promise<void> {
      await run('readwrite', (store) =>
        store.delete(JSON.stringify([scope, id])),
      );
    },
  };
}

export async function clearVideoDrafts() {
  generation++;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      transaction.objectStore('files').clear();
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Draft storage unavailable'));
    });
  } finally {
    db.close();
  }
}
