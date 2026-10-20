import 'server-only';
import { eq } from 'drizzle-orm';
import { getAuth } from '@/server/auth';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { ownerSettings } from '@/server/db/schema/owner-settings';
import { stepsGoalSchema } from '@/contracts/steps-goal';

export class StepsGoalError extends Error {
  constructor(public readonly status: number) {
    super('Steps goal unavailable');
  }
}
async function ownerScope(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  if (!session) throw new StepsGoalError(401);
  const access = await authorize(headers, 'settings:manage', session.user.id);
  if (!access.ok) throw new StepsGoalError(access.status);
  return session.user.id;
}
function read(ownerId: string) {
  const row = getDatabase()
    .db.select()
    .from(ownerSettings)
    .where(eq(ownerSettings.ownerId, ownerId))
    .get();
  return stepsGoalSchema.parse({ dailyStepsGoal: row?.dailyStepsGoal ?? null });
}
export async function getStepsGoal(headers: Headers) {
  return read(await ownerScope(headers));
}
export async function getReadStepsGoal(headers: Headers, ownerId: string) {
  const access = await authorize(headers, 'measurements:read', ownerId);
  if (!access.ok) throw new StepsGoalError(access.status);
  return read(ownerId);
}
export async function saveStepsGoal(headers: Headers, input: unknown) {
  const ownerId = await ownerScope(headers);
  const value = stepsGoalSchema.parse(input);
  getDatabase()
    .db.insert(ownerSettings)
    .values({ ownerId, ...value })
    .onConflictDoUpdate({ target: ownerSettings.ownerId, set: value })
    .run();
  return value;
}
export async function getReportStepsGoal(headers: Headers, ownerId: string) {
  const access = await authorize(headers, 'reports:export', ownerId);
  if (!access.ok) throw new StepsGoalError(access.status);
  return read(ownerId).dailyStepsGoal;
}
