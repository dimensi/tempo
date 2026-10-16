import 'server-only';
import { authorize } from '@/server/auth/guards';
import { getYazioStatus } from '@/server/yazio/settings';
import { getTransformMateStatus } from '@/server/transformmate/connection';
import { listTrainers } from '@/server/access/trainers';
import { getStepsGoal } from '@/server/settings/steps-goal';
import { readSettingsSchema } from '@/contracts/read-settings';
export class ReadSettingsError extends Error {
  constructor(public status: number) {
    super('Settings unavailable');
  }
}
export async function readSettings(headers: Headers, ownerId: string) {
  const check = async () => {
    const access = await authorize(headers, 'trainers:manage', ownerId);
    if (!access.ok) throw new ReadSettingsError(access.status);
  };
  await check();
  const [yazio, transformMate, trainers, stepsGoal] = await Promise.all([
    getYazioStatus(headers),
    getTransformMateStatus(headers),
    listTrainers(headers, ownerId),
    getStepsGoal(headers),
  ]);
  await check();
  return readSettingsSchema.parse({
    yazio,
    transformMate,
    trainers,
    stepsGoal,
  });
}
