import 'server-only';
import { authorize } from '@/server/auth/guards';
import { dailyGoalsRepository } from '@/server/yazio/goals';
import { z } from 'zod';
export class DailyGoalsError extends Error {
  constructor(public status: number) {
    super('Goals unavailable');
  }
}
export async function getDailyGoals(
  headers: Headers,
  ownerId: string,
  date: string,
  permission: 'measurements:read' | 'reports:export' = 'measurements:read',
) {
  const access = await authorize(headers, permission, ownerId);
  if (!access.ok) throw new DailyGoalsError(access.status);
  return dailyGoalsRepository().day(ownerId, z.iso.date().parse(date));
}
