import 'server-only';
import { readServerEnv } from './env';
export async function getDemoFixtures() {
  if (
    process.env.NODE_ENV === 'production' ||
    readServerEnv().DEMO_MODE !== 'true'
  )
    throw new Error(
      'Demo fixtures are available only in explicit local demo mode',
    );
  return import('@/lib/demo/fixtures');
}
