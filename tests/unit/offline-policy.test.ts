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
import { ownerConfirmedYazioWeightPolicyVersion } from '@/contracts/yazio-weight-policy';
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
  schemaVersion: 2,
  weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
  fence: { partition: 'owner-a', generation: 3, deviceEpoch: 'epoch-a' },
  savedAt: 1000,
  expiresAt: 2000,
  sessionExpiresAt: 3000,
  snapshot: null,
  missingPhotos: [],
  photoBytes: 0,
};
it('defaults off and refuses foreign partitions, revoked generations and clock rollback', () => {
  expect(matchesFence(initialMetadata(), bundle.fence)).toBe(false);
  expect(canReadBundle(metadata, bundle, 1500)).toBe(true);
  for (const now of [999, NaN, Infinity])
    expect(canReadBundle(metadata, bundle, now)).toBe(false);
  expect(canReadBundle({ ...metadata, lastSeenAt: 1600 }, bundle, 1500)).toBe(
    false,
  );
  expect(canReadBundle(nextMetadata(metadata, 1500), bundle, 1500)).toBe(false);
  expect(
    canReadBundle({ ...metadata, partition: 'owner-b' }, bundle, 1500),
  ).toBe(false);
});
it('local eligibility does not grant or inherit server session expiry; quota and policy remain bounded', () => {
  expect(canReadBundle(metadata, bundle, 1000 + 3 * 86400000)).toBe(true);
  expect(bundle.expiresAt).toBe(2000);
  expect(bundle.sessionExpiresAt).toBe(3000);
  expect(
    canReadBundle(
      metadata,
      { ...bundle, photoBytes: offlineDeviceLimits.photoBytes },
      1500,
    ),
  ).toBe(true);
  expect(
    canReadBundle(
      metadata,
      { ...bundle, photoBytes: offlineDeviceLimits.photoBytes + 1 },
      1500,
    ),
  ).toBe(false);
  expect(
    canReadBundle(
      metadata,
      { ...bundle, weightPolicyVersion: 'unknown-unit/v0' },
      1500,
    ),
  ).toBe(false);
});
