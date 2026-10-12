import {
  OfflineStorage,
  purgeOfflineDevice,
  subscribeOfflineBlocked,
  withOfflineDevicePurge,
} from '../../src/lib/offline-device';
import { OfflineController } from '../../src/features/offline/controller';
import { prepareOfflineShell } from '../../src/features/offline/shell';
import { offlineFixture } from './fixtures';
const storage = new OfflineStorage();
let lastFence: Awaited<ReturnType<typeof storage.enable>>;
const now = Date.now();
let finishMutation!: () => void;
let mutation: Promise<string>;
let mutationEntered = false;
Object.assign(window, {
  offlineTest: {
    now,
    prepareShell: prepareOfflineShell,
    async shortenExpiry() {
      const fixture = offlineFixture(now);
      const identity = {
        contractVersion: fixture.contractVersion,
        partition: fixture.partition,
        connectionGeneration: fixture.connectionGeneration,
        role: fixture.role,
        serverNow: fixture.serverNow,
        expiresAt: new Date(now + 1000).toISOString(),
        sessionExpiresAt: new Date(now + 2000).toISOString(),
      };
      const controller = new OfflineController(
        storage,
        (async () => new Response(JSON.stringify(identity))) as typeof fetch,
        () => now,
        async () => {},
      );
      await controller.activate(true);
      const expiry = controller.getSnapshot().bundle?.expiresAt;
      controller.invalidate();
      return expiry;
    },
    startMutation() {
      mutationEntered = false;
      mutation = withOfflineDevicePurge(async () => {
        mutationEntered = true;
        await new Promise<void>((resolve) => {
          finishMutation = resolve;
        });
        return 'provider-success';
      });
    },
    enteredMutation() {
      return mutationEntered;
    },
    async finishMutation() {
      finishMutation();
      return mutation;
    },
    async seed(variant?: 'zero-entry' | 'empty' | 'photo-only' | 'totals') {
      const snapshot = offlineFixture(now);
      const id = 'I'.repeat(43);
      snapshot.photos.items = [
        {
          id,
          date: snapshot.from,
          daytime: 'breakfast',
          source: 'manual',
          observedAt: snapshot.serverNow,
          mime: 'image/png',
          downloadUrl: `/api/offline/photos/${id}?date=${snapshot.from}`,
        },
      ];
      const bytes = new Blob(
        [
          Uint8Array.from(
            atob(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8O8AAAAASUVORK5CYII=',
            ),
            (ch) => ch.charCodeAt(0),
          ),
        ],
        { type: 'image/png' },
      );
      if (variant) {
        const day = snapshot.diary[0]!;
        day.totals.calories = '123.456';
        for (const meal of day.meals) {
          for (const field of [
            'totals',
            'knownTotals',
            'officialTotals',
          ] as const)
            meal[field] = {
              calories: '0',
              protein: null,
              fat: '0.000',
              carbs: '0',
            };
          if (variant !== 'zero-entry') meal.entries = [];
        }
        if (variant === 'totals')
          day.meals.find(
            (meal) => meal.kind === 'snack',
          )!.officialTotals.protein = '3.5';
        if (variant === 'photo-only')
          snapshot.photos.items[0]!.daytime = 'lunch';
        else snapshot.photos.items = [];
      }
      const storedPhotos = variant ? [] : [{ id, bytes }];
      lastFence = await storage.enable(
        snapshot.partition,
        snapshot.connectionGeneration,
        now,
      );
      await storage.commit(
        {
          schemaVersion: 1,
          fence: lastFence,
          savedAt: now,
          expiresAt: now + 600000,
          sessionExpiresAt: now + 1200000,
          snapshot,
          missingPhotos: variant === 'photo-only' ? [id] : [],
          photoBytes: variant ? 0 : bytes.size,
        },
        storedPhotos,
        now,
      );
      return (await storage.read(now)).photos.length;
    },
    async read(time = now) {
      const value = await storage.read(time);
      return {
        present: !!value.bundle,
        photos: value.photos.length,
        enabled: value.metadata.enabled,
      };
    },
    async stale() {
      try {
        await storage.commit(
          {
            schemaVersion: 1,
            fence: lastFence,
            savedAt: now,
            expiresAt: now + 600000,
            sessionExpiresAt: now + 1200000,
            snapshot: offlineFixture(now),
            missingPhotos: [],
            photoBytes: 0,
          },
          [],
          now,
        );
        return false;
      } catch {
        return true;
      }
    },
    purge: purgeOfflineDevice,
    listen() {
      subscribeOfflineBlocked(() => {
        document
          .querySelector('[data-offline-private]')
          ?.setAttribute('hidden', '');
      });
    },
  },
});
