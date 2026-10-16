'use client';
import { CatalogPage } from '@/features/workouts';
import { useReadContext } from '@/lib/client-session';
export default function Page() {
  const context = useReadContext();
  return <CatalogPage ownerId={context.ownerId} />;
}
