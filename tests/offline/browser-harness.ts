import { shiftDate } from '../../src/contracts/nutrition-sync-dates';
import { ownerConfirmedYazioWeightPolicyVersion } from '../../src/contracts/yazio-weight-policy';
import {
  OfflineStorage,
  revealOfflineContent,
  purgeOfflineDevice,
  subscribeOfflineBlocked,
  withOfflineDevicePurge,
} from '../../src/lib/offline-device';
import { OfflineController } from '../../src/lib/offline-controller';
import { prepareOfflineShell } from '../../src/lib/offline-shell';
import { offlineFixture } from './fixtures';
const storage = new OfflineStorage();
let lastFence: Awaited<ReturnType<typeof storage.enable>>;
let now = Date.now();
let finishMutation!: () => void;
let mutation: Promise<string>;
let mutationEntered = false;
let raceReader: OfflineController;
let raceFlight: Promise<void>;
let releaseRaceIdentity!: () => void;
let raceIdentityEntered = false;
let raceGeneration = 'B'.repeat(43);
let raceCommits = 0;
let raceRequests = 0;
let racePublished: string[] = [];
let heldProvider: Promise<Response>;
let heldProviderEntered = false;
Object.assign(window, {
  offlineTest: {
    now,
    prepareShell: () => prepareOfflineShell(new AbortController().signal),
    startRefillRace() {
      raceIdentityEntered = false;
      raceCommits = 0;
      raceRequests = 0;
      racePublished = [];
      let first = true;
      const gate = new Promise<void>((resolve) => {
        releaseRaceIdentity = resolve;
      });
      const originalCommit = storage.commit.bind(storage);
      storage.commit = async (
        ...args: Parameters<OfflineStorage['commit']>
      ) => {
        raceCommits++;
        return originalCommit(...args);
      };
      raceReader = new OfflineController(
        storage,
        (async (url: string) => {
          raceRequests++;
          const snapshot = offlineFixture(Date.now());
          snapshot.connectionGeneration = raceGeneration;
          if (url === '/api/offline/identity') {
            const {
              contractVersion,
              weightPolicyVersion,
              partition,
              connectionGeneration,
              role,
              serverNow,
              expiresAt,
              sessionExpiresAt,
            } = snapshot;
            if (first) {
              first = false;
              raceIdentityEntered = true;
              await gate;
            }
            return new Response(
              JSON.stringify({
                contractVersion,
                weightPolicyVersion,
                partition,
                connectionGeneration,
                role,
                serverNow,
                expiresAt,
                sessionExpiresAt,
              }),
            );
          }
          return new Response(JSON.stringify(snapshot));
        }) as typeof fetch,
        Date.now,
        async () => {},
        () => 'UTC',
      );
      const node = document.createElement('div');
      node.dataset.offlinePrivate = '';
      node.dataset.testid = 'race-private';
      node.hidden = true;
      document.body.append(node);
      // Model delayed cross-tab delivery: exclusion must work without notification timing.
      raceReader.subscribe(() => {
        const bundle = raceReader.getSnapshot().bundle;
        node.hidden = true;
        if (bundle) {
          racePublished.push(bundle.snapshot.connectionGeneration);
          node.textContent = 'Synthetic race private';
          revealOfflineContent(bundle.fence);
        }
      });
      raceFlight = raceReader.activate(true, true);
    },
    releaseRefillIdentity() {
      releaseRaceIdentity();
    },
    waitRefill() {
      return raceFlight;
    },
    retryRefill() {
      return raceReader.activate(true, true);
    },
    raceState() {
      return {
        entered: raceIdentityEntered,
        commits: raceCommits,
        requests: raceRequests,
        published: racePublished,
        status: raceReader.getSnapshot().status,
      };
    },
    setRaceGeneration() {
      raceGeneration = 'Z'.repeat(43);
    },
    startHeldProvider() {
      heldProviderEntered = false;
      heldProvider = withOfflineDevicePurge(async () => {
        heldProviderEntered = true;
        return fetch('/api/transformmate/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ synthetic: true }),
        });
      });
    },
    heldProviderEntered() {
      return heldProviderEntered;
    },
    finishHeldProvider() {
      return heldProvider.then((response) => response.status);
    },
    async cacheWithoutLocks() {
      const manager = navigator.locks;
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
      });
      let requests = 0;
      try {
        const reader = new OfflineController(storage, (async () => {
          requests++;
          throw new Error('must not fetch');
        }) as typeof fetch);
        await reader.activate(true);
        return {
          requests,
          status: reader.getSnapshot().status,
          error: reader.getSnapshot().error,
          bundle: reader.getSnapshot().bundle,
        };
      } finally {
        Object.defineProperty(navigator, 'locks', {
          value: manager,
          configurable: true,
        });
      }
    },
    async removeLinkedNative() {
      const current = await storage.read(Date.now(), 'UTC');
      current.bundle!.snapshot.nativeTrainings = [];
      await storage.commit(current.bundle!, current.photos, Date.now(), 'UTC');
    },
    async shortenExpiry() {
      const fixture = offlineFixture(now);
      const identity = {
        contractVersion: fixture.contractVersion,
        weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
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
    async seed(
      variant?:
        | 'zero-entry'
        | 'empty'
        | 'photo-only'
        | 'totals'
        | 'linked-plan'
        | 'sections',
      time?: number,
    ) {
      now = time ?? Date.now();
      const snapshot = offlineFixture(
        now,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      const id = 'I'.repeat(43);
      snapshot.photos.items = [
        {
          id,
          date: snapshot.to,
          daytime: 'breakfast',
          source: 'manual',
          observedAt: snapshot.serverNow,
          mime: 'image/png',
          downloadUrl: `/api/offline/photos/${id}?date=${snapshot.to}`,
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
      if (variant === 'sections') {
        const date = snapshot.to;
        const day = snapshot.diary[0]!;
        snapshot.views.summary = {
          dailyStepsGoal: 10000,
          from: shiftDate(date, -365),
          to: date,
          workouts: {
            planned: { date, title: 'Synthetic plan' },
            completed: { date, title: 'Synthetic actual' },
          },
          latestWeight: { date, value: '72.125' },
          nutrition: [
            {
              date,
              fetchedAt: day.fetchedAt,
              totals: day.totals,
              knownTotals: day.knownTotals,
              hasEntries: true,
            },
          ],
          body: snapshot.measurements.map((row) => ({
            id: row.key,
            measuredAt: row.measuredAt,
            values: row.values,
          })),
          bodyComplete: true,
          weight: {
            range: { from: shiftDate(date, -365), to: date },
            local: [
              {
                measuredAt: date,
                value: '72.125',
                unit: 'kg',
                source: 'LOCAL',
              },
            ],
            imported: [],
          },
          steps: snapshot.dailySteps.map(({ date, steps, observedAt }) => ({
            date,
            steps,
            observedAt,
          })),
        };
        snapshot.views.settings = {
          yazioConnected: true,
          transformMateConnected: false,
          initialFrom: date,
          timezone: 'UTC',
          automaticSync: true,
          lastSuccess: snapshot.serverNow,
        };
        snapshot.views.comments = [
          {
            key: 'comment',
            target: `/diary?date=${date}`,
            date,
            parentKey: null,
            authorName: 'Synthetic coach',
            body: 'Saved offline comment',
            createdAt: snapshot.serverNow,
          },
        ];
        snapshot.views.catalog = [
          {
            id: 123,
            name: 'Saved catalog exercise',
            description: 'Saved description',
            muscleGroups: ['Legs'],
            fetchedAt: snapshot.serverNow,
            hasVideo: false,
          },
        ];
      }
      if (variant === 'linked-plan') {
        snapshot.transformMateFacts[0]!.plannedHref =
          snapshot.plannedWorkouts[0]!.href;
        snapshot.transformMateFacts[0]!.nativeHref =
          snapshot.nativeTrainings[0]!.href;
      }
      if (variant && variant !== 'linked-plan' && variant !== 'sections') {
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
      const storedPhotos =
        variant && variant !== 'linked-plan' && variant !== 'sections'
          ? []
          : [{ id, bytes }];
      lastFence = await storage.enable(
        snapshot.partition,
        snapshot.connectionGeneration,
        now,
      );
      await storage.commit(
        {
          schemaVersion: 2,
          weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
          fence: lastFence,
          savedAt: now,
          expiresAt: now + 600000,
          sessionExpiresAt: now + 1200000,
          snapshot,
          missingPhotos: variant === 'photo-only' ? [id] : [],
          photoBytes:
            variant && variant !== 'linked-plan' && variant !== 'sections'
              ? 0
              : bytes.size,
        },
        storedPhotos,
        now,
      );
      return (await storage.read(now)).photos.length;
    },
    async commitOldPhoto() {
      const cached = await storage.read(now);
      const bundle = cached.bundle!;
      const old = shiftDate(bundle.snapshot.from, -1);
      for (const photo of bundle.snapshot.photos.items) photo.date = old;
      await storage.commit(bundle, cached.photos, now);
      return (await storage.read(now)).photos.length;
    },
    async upgradeOnline() {
      const snapshot = offlineFixture(now);
      const {
        contractVersion,
        weightPolicyVersion,
        partition,
        connectionGeneration,
        role,
        serverNow,
        expiresAt,
        sessionExpiresAt,
      } = snapshot;
      const identity = {
        contractVersion,
        weightPolicyVersion,
        partition,
        connectionGeneration,
        role,
        serverNow,
        expiresAt,
        sessionExpiresAt,
      };
      const before = await storage.metadata();
      const requests: string[] = [];
      const controller = new OfflineController(
        storage,
        (async (url: string) => {
          requests.push(url);
          return new Response(
            JSON.stringify(
              url === '/api/offline/identity' ? identity : snapshot,
            ),
          );
        }) as typeof fetch,
        () => now,
        async () => {},
        () => 'UTC',
      );
      const nativePublishes: number[] = [];
      controller.subscribe(() => {
        const bundle = controller.getSnapshot().bundle;
        if (bundle)
          nativePublishes.push(bundle.snapshot.nativeTrainings.length);
      });
      await controller.activate(true, true);
      const state = controller.getSnapshot();
      const metadata = await storage.metadata();
      const result = {
        enabled: state.enabled,
        status: state.status,
        native: state.bundle?.snapshot.nativeTrainings.length,
        photos: state.photos.length,
        generationAdvanced: metadata.generation > before.generation,
        nativePublishes,
        requests,
      };
      controller.invalidate();
      return result;
    },
    async alterNative(mode: 'old-format' | 'pre-native' | 'boundary') {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('yazio-offline-read-v1', 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['metadata', 'bundle'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        const request = tx.objectStore('bundle').get('current');
        request.onsuccess = () => {
          const bundle = request.result;
          if (mode === 'old-format') {
            bundle.schemaVersion = 1;
            delete bundle.weightPolicyVersion;
            bundle.snapshot.importedWeights[0].unit = null;
            delete bundle.snapshot.importedWeights[0].unitStatus;
            const metadata = tx.objectStore('metadata').get('current');
            metadata.onsuccess = () => {
              const value = metadata.result;
              delete value.weightPolicyVersion;
              tx.objectStore('metadata').put(value, 'current');
            };
          } else if (mode === 'pre-native') {
            delete bundle.snapshot.nativeTrainings;
          } else {
            const date = bundle.snapshot.from;
            for (const item of bundle.snapshot.photos.items) item.date = date;
            for (const key of [
              'diary',
              'dailySteps',
              'plannedWorkouts',
              'workoutSessions',
              'transformMateFacts',
              'nativeTrainings',
            ])
              for (const item of bundle.snapshot[key]) item.date = date;
            for (const item of bundle.snapshot.measurements)
              item.measuredAt = date;
            for (const item of bundle.snapshot.importedWeights)
              item.measuredDate = date;
          }
          tx.objectStore('bundle').put(bundle, 'current');
        };
      });
      db.close();
    },
    async rawCounts() {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('yazio-offline-read-v1', 2);
        request.onsuccess = () => resolve(request.result);
      });
      const result = await new Promise<{ bundle: number; photos: number }>(
        (resolve) => {
          const tx = db.transaction(['bundle', 'photos'], 'readonly');
          const bundle = tx.objectStore('bundle').count();
          const photos = tx.objectStore('photos').count();
          tx.oncomplete = () =>
            resolve({ bundle: bundle.result, photos: photos.result });
        },
      );
      db.close();
      return result;
    },
    async details(time = now) {
      const value = await storage.read(time);
      const snapshot = value.bundle?.snapshot;
      return {
        enabled: value.metadata.enabled,
        photos: value.photos.length,
        collections: snapshot
          ? [
              snapshot.diary.length,
              snapshot.photos.items.length,
              snapshot.measurements.length,
              snapshot.importedWeights.length,
              snapshot.dailySteps.length,
              snapshot.plannedWorkouts.length,
              snapshot.workoutSessions.length,
              snapshot.transformMateFacts.length,
              snapshot.nativeTrainings.length,
            ]
          : null,
      };
    },
    async read(time = now) {
      const value = await storage.read(time);
      return {
        present: !!value.bundle,
        photos: value.photos.length,
        enabled: value.metadata.enabled,
      };
    },
    async savedGoal() {
      return (await storage.read(Date.now())).bundle?.snapshot.views.summary
        ?.dailyStepsGoal;
    },
    async stale() {
      try {
        await storage.commit(
          {
            schemaVersion: 2,
            weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
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

Object.defineProperty(Reflect.get(window, 'offlineTest'), 'now', {
  get: () => now,
});
