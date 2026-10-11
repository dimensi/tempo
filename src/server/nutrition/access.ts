import 'server-only';
import { authorize } from '@/server/auth/guards';
import { ownerIdSchema } from '@/contracts/nutrition-sync';
import type { Permission } from '@/contracts/permissions';

export class NutritionAccessError extends Error {
  constructor(public readonly status: number) {
    super('Access denied');
  }
}
export async function nutritionAccess(
  headers: Headers,
  ownerId: string,
  permission: Permission = 'nutrition:read',
) {
  ownerIdSchema.parse(ownerId);
  const result = await authorize(headers, permission, ownerId);
  if (!result.ok) throw new NutritionAccessError(result.status);
  return result.session;
}
