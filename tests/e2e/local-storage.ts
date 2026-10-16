import type { Page } from '@playwright/test';

export async function seedVideoDraft(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('tempo-video-upload', 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('drafts');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('drafts', 'readwrite');
          tx.objectStore('drafts').put(
            {
              blob: new Blob(['private compressed video'], {
                type: 'video/mp4',
              }),
              duration: 1,
              expiresAt: Date.now() + 86400000,
            },
            'another-workout-draft',
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
}

export async function storedRows(
  page: Page,
  database: string,
  store: string,
  version: number,
) {
  return page.evaluate(
    ({ database, store, version }) =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open(database, version);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(store, 'readonly');
          const count = tx.objectStore(store).count();
          count.onsuccess = () => resolve(count.result);
          tx.oncomplete = () => db.close();
        };
      }),
    { database, store, version },
  );
}
