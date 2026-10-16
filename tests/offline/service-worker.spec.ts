import { expect, test } from '../ci/isolated-test';
import { seedVideoDraft, storedRows } from '../e2e/local-storage';
test('retirement removes only app shell caches and preserves files and the durable queue', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await seedVideoDraft(page);
  await request.post('/__offline-test/control', { data: { mode: 'legacy' } });
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/offline-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    await (
      await caches.open('yazio-offline-app-v2:synthetic')
    ).put('/old-shell', new Response('old'));
    await (
      await caches.open('unrelated-cache')
    ).put('/keep', new Response('keep'));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('yazio-offline-read-v1', 3);
      request.onupgradeneeded = () => {
        for (const name of [
          'metadata',
          'bundle',
          'photos',
          'files',
          'resources',
        ])
          request.result.createObjectStore(name);
      };
      request.onsuccess = () => {
        const tx = request.result.transaction('files', 'readwrite');
        tx.objectStore('files').put(
          {
            id: 'pending',
            bytes: new Blob(['saved pdf'], { type: 'application/pdf' }),
          },
          'pending',
        );
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
      };
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('yazio-offline-writes-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(
          { partition: 'owner', operations: [{ id: 'pending' }] },
          'current',
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
      request.onerror = () => reject(request.error);
    });
  });
  await request.post('/__offline-test/control', { data: { mode: 'current' } });
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    await registration?.update();
  });
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    )
    .toBe(0);
  expect(await page.evaluate(async () => await caches.keys())).toEqual([
    'unrelated-cache',
  ]);
  expect(
    await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const request = indexedDB.open('yazio-offline-read-v1', 3);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('files', 'readonly');
            const row = tx.objectStore('files').get('pending');
            row.onsuccess = async () => resolve(await row.result.bytes.text());
            tx.oncomplete = () => db.close();
          };
          request.onerror = () => reject(request.error);
        }),
    ),
  ).toBe('saved pdf');
  expect(
    await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const request = indexedDB.open('yazio-offline-writes-v1', 1);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('state', 'readonly');
            const row = tx.objectStore('state').get('current');
            row.onsuccess = () => resolve(row.result.operations[0].id);
            tx.oncomplete = () => db.close();
          };
          request.onerror = () => reject(request.error);
        }),
    ),
  ).toBe('pending');
  await expect(page).toHaveURL('/login');
  expect(await storedRows(page, 'tempo-video-upload', 'drafts', 1)).toBe(1);
  expect((await page.request.get('/api/read/context')).status()).toBe(401);
});
test('ordinary application boot does not register an offline worker or request shell assets', async ({
  page,
}) => {
  const shells: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/offline/'))
      shells.push(request.url());
  });
  await page.goto('/login');
  await expect(page.getByLabel('Электронная почта')).toBeVisible();
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    ),
  ).toBe(0);
  expect(shells).toEqual([]);
});
