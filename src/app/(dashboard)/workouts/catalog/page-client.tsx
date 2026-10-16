'use client';
import { CatalogPage } from '@/features/workouts';
import { useReadContext } from '@/lib/client-session';
export function CatalogReadPage() {
  const context = useReadContext();
  return <CatalogPage ownerId={context.ownerId} />;
}
