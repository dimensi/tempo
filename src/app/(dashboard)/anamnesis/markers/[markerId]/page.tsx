import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import { MarkerPage } from '../../../read-pages';
export function generateMetadata() {
  return { title: m.markers.title };
}
export default async function Page({
  params,
}: {
  params: Promise<{ markerId: string }>;
}) {
  const value = await params;
  return <MarkerPage markerId={value.markerId} />;
}
