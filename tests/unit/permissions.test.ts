import { describe, expect, it } from 'vitest';
import { hasPermission, permissions } from '@/contracts/permissions';
describe('permissions', () => {
  it('grants the owner every declared permission', () => {
    for (const permission of permissions)
      expect(hasPermission('OWNER', permission)).toBe(true);
  });
  it('never grants owner-only operations to trainer or unknown roles', () => {
    for (const role of ['TRAINER', 'owner', 'ADMIN', ''])
      for (const permission of [
        'yazio:manage',
        'trainers:manage',
        'nutrition:write',
        'measurements:write',
      ] as const)
        expect(hasPermission(role, permission)).toBe(false);
  });
  it('allows trainer planning and reading', () => {
    expect(hasPermission('TRAINER', 'workouts:plan')).toBe(true);
    expect(hasPermission('TRAINER', 'nutrition:read')).toBe(true);
  });
});
