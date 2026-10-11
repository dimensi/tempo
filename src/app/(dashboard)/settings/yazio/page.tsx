import { headers } from 'next/headers';
import { requireSession } from '@/server/auth/guards';
import { getYazioStatus } from '@/server/yazio/settings';
import { YazioSettingsForm } from './settings-form';
export default async function YazioSettingsPage() {
  await requireSession();
  const status = await getYazioStatus(await headers());
  return <YazioSettingsForm initial={status} />;
}
