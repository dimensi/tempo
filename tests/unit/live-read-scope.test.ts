import { expect, it } from 'vitest';
import { canRetainLiveRead } from '@/lib/live-read-scope';
it('allows owner provider rebinding without revealing a different account or role', () => {
  const owner = {
    partition: 'owner',
    connectionGeneration: 'before',
    role: 'OWNER' as const,
  };
  expect(
    canRetainLiveRead(owner, { ...owner, connectionGeneration: 'after' }),
  ).toBe(true);
  expect(canRetainLiveRead(owner, { ...owner, partition: 'other' })).toBe(
    false,
  );
  expect(canRetainLiveRead(owner, { ...owner, role: 'TRAINER' })).toBe(false);
});
it('requires the identical grant generation for retained trainer screens', () => {
  const trainer = {
    partition: 'trainer',
    connectionGeneration: 'before',
    role: 'TRAINER' as const,
  };
  expect(canRetainLiveRead(trainer, trainer)).toBe(true);
  expect(
    canRetainLiveRead(trainer, { ...trainer, connectionGeneration: 'revoked' }),
  ).toBe(false);
});
