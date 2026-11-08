const stores = ['metadata', 'bundle', 'photos', 'files', 'resources'];
/** Keep the existing database and file stores when retiring the old shell. */
export async function browserStore<T>(
  names: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('yazio-offline-read-v1', 3);
    request.onupgradeneeded = () => {
      for (const name of stores)
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Storage unavailable'));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error('Storage unavailable'));
      try {
        run(tx, (next) => {
          value = next;
        });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}
export async function clearReadStorage() {
  await browserStore<void>(['resources'], 'readwrite', (tx) => {
    tx.objectStore('resources').clear();
  });
}

/** Retire file downloads without touching cached reads, drafts, or queued writes. */
export async function retireOfflineDownloads() {
  await browserStore<void>(['files', 'metadata'], 'readwrite', (tx) => {
    tx.objectStore('files').clear();
    const request = tx
      .objectStore('metadata')
      .openCursor(
        IDBKeyRange.bound(
          'workout-download:',
          'workout-download;',
          false,
          true,
        ),
      );
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  });
}
