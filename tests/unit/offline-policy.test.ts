import { expect, it } from 'vitest';
import {
  canReadBundle,
  matchesFence,
  nextMetadata,
  initialMetadata,
  offlineDeviceLimits,
  type CacheMetadata,
  type CachedBundle,
} from '@/lib/offline-device';
const metadata: CacheMetadata = {
  ...initialMetadata(),
  enabled: true,
  partition: 'owner-a',
  generation: 3,
  connectionGeneration: 'connection-a',
  lastSeenAt: 1000,
  deviceEpoch: 'epoch-a',
};
const bundle: CachedBundle<null> = {
  schemaVersion: 1,
  fence: { partition: 'owner-a', generation: 3, deviceEpoch: 'epoch-a' },
  savedAt: 1000,
  expiresAt: 2000,
  sessionExpiresAt: 3000,
  snapshot: null,
  missingPhotos: [],
  photoBytes: 0,
};
it('defaults off and refuses foreign partitions, revoked generations and expired/rollback reads', () => {
  expect(matchesFence(initialMetadata(), bundle.fence)).toBe(false);
  expect(canReadBundle(metadata, bundle, 1500)).toBe(true);
  for (const now of [999, 2000, NaN, Infinity])
    expect(canReadBundle(metadata, bundle, now)).toBe(false);
  expect(canReadBundle({ ...metadata, lastSeenAt: 1600 }, bundle, 1500)).toBe(
    false,
  );
  expect(canReadBundle(nextMetadata(metadata, 1500), bundle, 1500)).toBe(false);
  expect(
    canReadBundle({ ...metadata, partition: 'owner-b' }, bundle, 1500),
  ).toBe(false);
});
it('caps validity by 24h and session expiry and refuses oversized photo caches', () => {
  expect(
    canReadBundle(
      metadata,
      {
        ...bundle,
        expiresAt: bundle.savedAt + offlineDeviceLimits.lifetimeMs,
        sessionExpiresAt:
          bundle.savedAt + offlineDeviceLimits.lifetimeMs + 1000,
        photoBytes: offlineDeviceLimits.photoBytes,
      },
      1500,
    ),
  ).toBe(true);
  expect(
    canReadBundle(
      metadata,
      {
        ...bundle,
        expiresAt: bundle.savedAt + offlineDeviceLimits.lifetimeMs + 1,
        sessionExpiresAt:
          bundle.savedAt + offlineDeviceLimits.lifetimeMs + 1000,
      },
      1500,
    ),
  ).toBe(false);
  expect(
    canReadBundle(metadata, { ...bundle, sessionExpiresAt: 1900 }, 1500),
  ).toBe(false);
  expect(
    canReadBundle(
      metadata,
      { ...bundle, photoBytes: offlineDeviceLimits.photoBytes + 1 },
      1500,
    ),
  ).toBe(false);
});
