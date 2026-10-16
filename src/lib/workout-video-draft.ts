// Only the compressed upload is retained; original camera files are never persisted.
export interface VideoDraft {
  blob: Blob;
  duration: number;
  uploadId?: string;
}
let generation = 0;
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tempo-video-upload', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('drafts', 'readwrite');
      const cursor = transaction.objectStore('drafts').openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (!item.value.expiresAt || item.value.expiresAt <= Date.now())
          item.delete();
        item.continue();
      };
      transaction.oncomplete = () => resolve(db);
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    };
    request.onerror = () => reject(request.error);
  });
}
export async function videoDraft(
  key: string,
  mode: 'read' | 'write' | 'delete',
  value?: VideoDraft,
): Promise<VideoDraft | undefined> {
  const currentGeneration = generation;
  const db = await database();
  try {
    if (currentGeneration !== generation) throw new Error('Drafts cleared');
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(
        'drafts',
        mode === 'read' ? 'readonly' : 'readwrite',
      );
      const store = transaction.objectStore('drafts');
      const request =
        mode === 'read'
          ? store.get(key)
          : mode === 'write'
            ? store.put(
                { ...value, expiresAt: Date.now() + 24 * 60 * 60 * 1000 },
                key,
              )
            : store.delete(key);
      transaction.oncomplete = () => {
        const result = request.result as
          (VideoDraft & { expiresAt: number }) | undefined;
        resolve(
          mode === 'read' && result?.expiresAt && result.expiresAt > Date.now()
            ? result
            : undefined,
        );
      };
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function clearVideoDrafts() {
  generation++;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite');
      transaction.objectStore('drafts').clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
